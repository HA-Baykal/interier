import fs from "fs";
import path from "path";
import { DbShape } from "./types";

/**
 * Lightweight data store used during the testing phase.
 *
 * It exposes a clean async repository interface (`db`, `mutate`) so business
 * logic doesn't care where data lives. Backends:
 *   - Remote (Vercel): Upstash Redis / Vercel KV via `@upstash/redis`
 *     (env: UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN, or legacy
 *     KV_REST_API_URL + KV_REST_API_TOKEN). The whole `DbShape` document is
 *     stored under a single key — no schema / migration needed.
 *   - Local (dev): a JSON file at `data/app.json` (or `DATABASE_PATH`).
 *
 * The remote path is used automatically when the Redis env vars are present;
 * otherwise a local file is used so the app still runs in development.
 */

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

let cache: DbShape | null = null;

/* -------- remote (Redis) -------- */
async function getRedis() {
  const { Redis } = await import("@upstash/redis");
  return new Redis({ url: REDIS_URL!, token: REDIS_TOKEN! });
}

async function readRemote(): Promise<DbShape | null> {
  const r = await getRedis();
  const raw = await r.get<string>(REMOTE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as DbShape;
  } catch {
    return null;
  }
}

async function writeRemote(state: DbShape): Promise<void> {
  const r = await getRedis();
  await r.set(REMOTE_KEY, JSON.stringify(state));
}

/* -------- local (file) -------- */
function writeFile(state: DbShape) {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = DB_FILE + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2), "utf-8");
  fs.renameSync(tmp, DB_FILE);
}

function readFile(): DbShape | null {
  if (!fs.existsSync(DB_FILE)) return null;
  try {
    return JSON.parse(fs.readFileSync(DB_FILE, "utf-8")) as DbShape;
  } catch {
    return null;
  }
}

async function persistTo(state: DbShape): Promise<void> {
  if (REMOTE) await writeRemote(state);
  else writeFile(state);
}

async function load(): Promise<DbShape> {
  if (cache) return cache;
  let data = REMOTE ? await readRemote() : readFile();
  if (!data) {
    data = structuredClone(EMPTY);
    await persistTo(data);
  }
  // Merge defaults so newly-added collections always exist.
  cache = { ...structuredClone(EMPTY), ...data };
  return cache;
}

export async function db(): Promise<DbShape> {
  return load();
}

export async function persist(state?: DbShape): Promise<void> {
  const data = state ?? cache ?? structuredClone(EMPTY);
  cache = data;
  await persistTo(data);
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

/** Thread-safe reset used by tests / the admin "reset demo data" action. */
export async function resetDb(): Promise<void> {
  cache = null;
  if (REMOTE) {
    const r = await getRedis();
    await r.del(REMOTE_KEY);
  } else if (fs.existsSync(DB_FILE)) {
    fs.rmSync(DB_FILE);
  }
}
