import fs from "fs";
import path from "path";
import { Redis } from "@upstash/redis";
import { randomUUID } from "node:crypto";
import type { DbShape } from "./types";
import { redisConnection, redisDbKey, isVercel } from "./storage-config";
import { RequestError, safeErrorMessage } from "./errors";

const DB_FILE = path.resolve(process.cwd(), process.env.DATABASE_PATH || "data/app.json");
const EMPTY: DbShape = { users: [], sessions: [], generations: [], rewards: [], referrals: [], styles: [], packages: [], settings: [] };
let memoryState: DbShape | null = null;
let memoryFallback = false;
let redis: { url: string; token: string; client: Redis } | null = null;
let mutationQueue = Promise.resolve();
const warned = new Set<string>();

function warnOnce(key: string, message: string) {
  if (!warned.has(key)) { warned.add(key); console.warn(`[interier/db] ${message}`); }
}

export function storageMode(): "redis" | "file" | "memory" {
  if (redisConnection().configured) return "redis";
  return memoryFallback || isVercel() ? "memory" : "file";
}

async function getRedis(): Promise<Redis> {
  const cfg = redisConnection();
  if (!cfg.configured) throw new RequestError("database_not_configured", `Missing Redis variables: ${cfg.missing.join(", ")}`, 503);
  let url: URL;
  try { url = new URL(cfg.url); } catch { throw new RequestError("database_config_invalid", "Redis REST URL must be an https:// URL", 503); }
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) {
    throw new RequestError("database_config_invalid", "Redis REST URL must use HTTPS without credentials, query or fragment", 503);
  }
  if (!redis || redis.url !== cfg.url || redis.token !== cfg.token) {
    redis = { url: cfg.url, token: cfg.token, client: new Redis({
      url: cfg.url, token: cfg.token, automaticDeserialization: false,
      enableAutoPipelining: false, retry: false, cache: "no-store", responseEncoding: false,
      signal: () => AbortSignal.timeout(6_000),
    }) };
  }
  return redis.client;
}

/** Support legacy strings, double-encoded strings and already-deserialized objects. */
export function coerceDatabase(raw: unknown): DbShape | null {
  let value: unknown = raw;
  for (let i = 0; i < 3 && typeof value === "string"; i++) {
    try { value = JSON.parse(value); } catch { return null; }
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const src = value as Record<string, unknown>;
  const out = structuredClone(EMPTY);
  let matched = 0;
  for (const key of Object.keys(EMPTY) as (keyof DbShape)[]) {
    if (Array.isArray(src[key])) {
      matched++;
      (out[key] as unknown[]) = structuredClone(src[key] as unknown[]);
    } else if (key in src) {
      // Do not "repair" a broken users collection to [], wiping accounts.
      return null;
    }
  }
  return matched ? out : null;
}

async function readRemote() {
  const client = await getRedis();
  const key = redisDbKey();
  const raw = await client.get<string>(key);
  if (raw === null || raw === undefined) return { raw: null, state: structuredClone(EMPTY) };
  const state = coerceDatabase(raw);
  if (state) return { raw, state };
  if (!warned.has(`corrupt:${key}`)) {
    try { await client.set(`${key}:corrupt:${Date.now()}`, raw); } catch { /* keep the original regardless */ }
    warnOnce(`corrupt:${key}`, "Unreadable Redis document preserved; refusing to replace user data with an empty database.");
  }
  throw new RequestError("database_corrupt", "База Redis повреждена. Исходные данные сохранены; автоматический сброс отключён.", 503);
}

function readFile(): DbShape {
  if (storageMode() === "memory") return structuredClone(memoryState ?? EMPTY);
  let text: string;
  try { text = fs.readFileSync(DB_FILE, "utf-8"); }
  catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return structuredClone(EMPTY);
    throw e;
  }
  const state = coerceDatabase(text);
  if (state) return state;
  if (!warned.has("file-corrupt")) {
    try { fs.copyFileSync(DB_FILE, `${DB_FILE}.corrupt-${Date.now()}`); } catch { /* keep original */ }
    warnOnce("file-corrupt", "Unreadable database file preserved; automatic reset is disabled.");
  }
  throw new RequestError("database_corrupt", "Локальная база повреждена. Исходный файл сохранён; автоматический сброс отключён.", 503);
}

function writeFile(state: DbShape) {
  if (storageMode() === "memory") { memoryState = structuredClone(state); return; }
  const tmp = `${DB_FILE}.${randomUUID()}.tmp`;
  try {
    fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });
    fs.writeFileSync(tmp, JSON.stringify(state, null, 2), { encoding: "utf-8", mode: 0o600 });
    fs.renameSync(tmp, DB_FILE);
  } catch (e) {
    try { fs.unlinkSync(tmp); } catch { /* file may not have been created */ }
    if (!["EROFS", "EACCES", "EPERM"].includes((e as NodeJS.ErrnoException).code || "")) throw e;
    memoryFallback = true;
    memoryState = structuredClone(state);
    warnOnce("readonly", "Read-only filesystem: data is temporary. Connect Upstash Redis before using real accounts.");
  }
}

async function load(): Promise<DbShape> {
  const connection = redisConnection();
  if (connection.configured) return (await readRemote()).state;
  if (connection.partial) throw new RequestError("database_not_configured", `Incomplete Redis configuration: ${connection.missing.join(", ")}`, 503);
  return readFile();
}

export async function db(): Promise<DbShape> { return load(); }

// Compare-and-set is atomic across DIFFERENT Vercel instances. Never overwrite a
// document another request changed between our GET and SET. No locks can expire
// mid-write, and a GET of an empty database never persists an empty document.
const CAS = `
local current = redis.call('GET', KEYS[1])
if (current or '') ~= ARGV[1] then return 0 end
redis.call('SET', KEYS[1], ARGV[2])
return 1
`;

async function serialize<T>(run: () => Promise<T>): Promise<T> {
  const previous = mutationQueue;
  let release!: () => void;
  mutationQueue = new Promise<void>((resolve) => { release = resolve; });
  await previous;
  try { return await run(); } finally { release(); }
}

/** Callback may be retried after a conflict: it must be synchronous and side-effect free. */
export async function mutate<T>(fn: (draft: DbShape) => T): Promise<T> {
  return serialize(async () => {
    const remote = redisConnection().configured;
    const deadline = Date.now() + 12_000;
    for (let attempt = 0; attempt < 12; attempt++) {
      const { raw, state } = remote ? await readRemote() : { raw: null, state: await load() };
      const result = fn(state);
      if (result instanceof Promise) throw new Error("Database mutations must be synchronous");
      if (!remote) { writeFile(state); return result; }
      const next = JSON.stringify(state);
      if (raw === next) return result;
      const client = await getRedis();
      // Automatic HTTP retries are off: a lost response must not reapply a
      // non-idempotent callback after a write that actually succeeded.
      if (await client.eval<string[], number>(CAS, [redisDbKey()], [raw ?? "", next]) === 1) return result;
      if (Date.now() > deadline) break;
      await new Promise((resolve) => setTimeout(resolve, 15 + Math.random() * 60));
    }
    throw new RequestError("database_busy", "База занята параллельными запросами. Повторите действие.", 503);
  });
}

export function uid(prefix = ""): string { const id = randomUUID(); return prefix ? `${prefix}_${id}` : id; }
export function now(): number { return Date.now(); }

export async function resetDb(): Promise<void> {
  await serialize(async () => {
    if (redisConnection().configured) await (await getRedis()).del(redisDbKey());
    else if (storageMode() === "memory") memoryState = null;
    else if (fs.existsSync(DB_FILE)) fs.unlinkSync(DB_FILE);
  });
}

/** A short-lived, separate test key; never writes or deletes the app database. */
export async function probeDatabase() {
  if (!redisConnection().configured) return { ok: !isVercel() && storageMode() === "file", mode: storageMode(), message: "Redis не подключён." };
  const key = `${redisDbKey()}:health:${randomUUID()}`;
  try {
    const client = await getRedis();
    const nonce = randomUUID();
    await client.set(key, nonce, { ex: 60 });
    const ok = await client.get<string>(key) === nonce;
    return { ok, mode: storageMode(), message: ok ? "Redis: запись и чтение работают." : "Redis: записанное значение не прочиталось." };
  } catch (e) {
    return { ok: false, mode: storageMode(), message: safeErrorMessage(e) };
  } finally {
    try { await (await getRedis()).del(key); } catch { /* TTL cleans up only this probe key */ }
  }
}
