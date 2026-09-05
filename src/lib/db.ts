import fs from "fs";
import path from "path";
import { DbShape } from "./types";

const DATA_DIR = path.join(process.cwd(), "data");
const DB_FILE = process.env.DATABASE_PATH
  ? path.resolve(process.cwd(), process.env.DATABASE_PATH)
  : path.join(DATA_DIR, "app.json");

const EMPTY: DbShape = {
  users: [],
  sessions: [],
  generations: [],
  rewards: [],
  referrals: [],
  styles: [],
  packages: [],
  settings: [],
};

const REDIS_URL = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
const REMOTE = !!REDIS_URL && !!REDIS_TOKEN;
const REMOTE_KEY = "app:db";

/**
 * When the filesystem is read-only (e.g. Vercel serverless without KV) we keep
 * the state in memory for the lifetime of the instance instead of crashing the
 * whole app on every request. Data is ephemeral, but the site — including the
 * admin login — stays usable and the reason is logged loudly.
 */
let memoryState: DbShape | null = null;
let memoryFallback = false;

function warnOnce(key: string, message: string) {
  const g = globalThis as unknown as { __interierWarned?: Set<string> };
  if (!g.__interierWarned) g.__interierWarned = new Set();
  if (g.__interierWarned.has(key)) return;
  g.__interierWarned.add(key);
  console.warn(`[interier/db] ${message}`);
}

/** Which storage backend is currently in use (handy for diagnostics). */
export function storageMode(): "redis" | "file" | "memory" {
  if (REMOTE) return "redis";
  return memoryFallback ? "memory" : "file";
}

async function getRedis() {
  const { Redis } = await import("@upstash/redis");
  return new Redis({ url: REDIS_URL!, token: REDIS_TOKEN! });
}

/**
 * Accept anything the storage layer may hand back and turn it into a valid
 * DbShape.
 *
 * This is deliberately forgiving: the Upstash client deserializes JSON values
 * automatically, so `get()` returns a plain **object**, while older writes (and
 * the local file) hold a JSON **string**. Blindly calling JSON.parse() on the
 * object throws, which used to make the database look empty — the app then
 * overwrote it with a blank state on every read, wiping the seeded admin
 * account (hence "the default admin login does not work").
 */
function coerce(raw: unknown): DbShape | null {
  let value: unknown = raw;

  // Unwrap (possibly repeatedly) JSON-encoded strings.
  for (let i = 0; i < 3 && typeof value === "string"; i++) {
    const trimmed = value.trim();
    if (!trimmed) return null;
    try {
      value = JSON.parse(trimmed);
    } catch {
      return null;
    }
  }

  if (!value || typeof value !== "object" || Array.isArray(value)) return null;

  const src = value as Record<string, unknown>;
  const out = structuredClone(EMPTY);
  let matchedKeys = 0;
  for (const key of Object.keys(EMPTY) as (keyof DbShape)[]) {
    const v = src[key];
    if (Array.isArray(v)) {
      matchedKeys++;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (out[key] as any[]) = v as any[];
    }
  }
  // A document that shares no collection with our schema is not our database.
  if (matchedKeys === 0) return null;
  return out;
}

async function readRemoteRaw(): Promise<unknown> {
  const r = await getRedis();
  return r.get(REMOTE_KEY);
}

/** Keep unreadable data around instead of silently destroying it. */
async function backupCorruptRemote(raw: unknown) {
  try {
    const r = await getRedis();
    const key = `${REMOTE_KEY}:corrupt:${Date.now()}`;
    await r.set(key, typeof raw === "string" ? raw : JSON.stringify(raw));
    warnOnce("remote-corrupt", `unreadable database document backed up to "${key}"`);
  } catch {
    /* best effort */
  }
}

async function writeRemote(state: DbShape): Promise<void> {
  const r = await getRedis();
  await r.set(REMOTE_KEY, JSON.stringify(state));
}

function writeFile(state: DbShape) {
  if (memoryFallback) {
    memoryState = state;
    return;
  }
  try {
    const dir = path.dirname(DB_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const tmp = DB_FILE + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(state, null, 2), "utf-8");
    fs.renameSync(tmp, DB_FILE);
  } catch (e) {
    const code = (e as NodeJS.ErrnoException)?.code;
    if (code === "EROFS" || code === "EACCES" || code === "EPERM") {
      memoryFallback = true;
      memoryState = state;
      warnOnce(
        "readonly-fs",
        `cannot write ${DB_FILE} (${code}) — falling back to in-memory storage. ` +
          "Data will be lost on restart: configure UPSTASH_REDIS_REST_URL/TOKEN " +
          "(serverless) or mount a writable disk for ./data."
      );
      return;
    }
    throw e;
  }
}

function readFile(): DbShape | null {
  if (memoryFallback) return memoryState;
  if (!fs.existsSync(DB_FILE)) return null;
  let text: string;
  try {
    text = fs.readFileSync(DB_FILE, "utf-8");
  } catch {
    return null;
  }
  const parsed = coerce(text);
  if (parsed) return parsed;
  // Never drop user data silently: keep a copy of the unreadable file.
  try {
    const backup = `${DB_FILE}.corrupt-${Date.now()}`;
    fs.copyFileSync(DB_FILE, backup);
    warnOnce("file-corrupt", `unreadable database file backed up to ${backup}`);
  } catch {
    /* best effort */
  }
  return null;
}

async function persistTo(state: DbShape): Promise<void> {
  if (REMOTE) await writeRemote(state);
  else writeFile(state);
}

async function load(): Promise<DbShape> {
  if (REMOTE) {
    const raw = await readRemoteRaw();
    const parsed = coerce(raw);
    if (parsed) return parsed;
    if (raw !== null && raw !== undefined && raw !== "") await backupCorruptRemote(raw);
  } else {
    const parsed = readFile();
    if (parsed) return parsed;
  }

  const fresh = structuredClone(EMPTY);
  await persistTo(fresh);
  return fresh;
}

export async function db(): Promise<DbShape> {
  return load();
}

export async function persist(state?: DbShape): Promise<void> {
  await persistTo(state ?? (await load()));
}

export async function mutate<T>(fn: (draft: DbShape) => T): Promise<T> {
  const d = await load();
  const result = fn(d);
  await persistTo(d);
  return result;
}

export function uid(prefix = ""): string {
  const rand =
    typeof crypto !== "undefined" && crypto.randomUUID
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2) + Date.now().toString(36);
  return prefix ? `${prefix}_${rand}` : rand;
}

export function now(): number {
  return Date.now();
}

export async function resetDb(): Promise<void> {
  if (REMOTE) {
    const r = await getRedis();
    await r.del(REMOTE_KEY);
  } else if (memoryFallback) {
    memoryState = null;
  } else if (fs.existsSync(DB_FILE)) {
    fs.rmSync(DB_FILE);
  }
}
