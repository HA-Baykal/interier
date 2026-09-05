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
  let data = REMOTE ? await readRemote() : readFile();
  if (!data) {
    data = structuredClone(EMPTY);
    await persistTo(data);
  }
  return { ...structuredClone(EMPTY), ...data };
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
  } else if (fs.existsSync(DB_FILE)) {
    fs.rmSync(DB_FILE);
  }
}
