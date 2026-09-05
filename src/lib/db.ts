import fs from "fs";
import path from "path";
import { DbShape } from "./types";

/**
 * Lightweight JSON-file store used during the testing phase.
 * It keeps a clean repository interface so it can later be swapped
 * for PostgreSQL / SQLite / Prisma without touching the business logic.
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

let cache: DbShape | null = null;
let writeQueue: Promise<void> = Promise.resolve();

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function load(): DbShape {
  if (cache) return cache;
  ensureDir();
  if (!fs.existsSync(DB_FILE)) {
    cache = structuredClone(EMPTY);
    persist(cache);
    return cache;
  }
  try {
    const raw = fs.readFileSync(DB_FILE, "utf-8");
    const parsed = JSON.parse(raw);
    const merged: DbShape = { ...structuredClone(EMPTY), ...parsed };
    cache = merged;
    return merged;
  } catch (e) {
    const empty: DbShape = structuredClone(EMPTY);
    cache = empty;
    return empty;
  }
}

export function persist(state?: DbShape) {
  const data = state ?? cache ?? structuredClone(EMPTY);
  ensureDir();
  const tmp = DB_FILE + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), "utf-8");
  fs.renameSync(tmp, DB_FILE);
}

export function db(): DbShape {
  if (!cache) load();
  return cache!;
}

/** Serialize mutations and persist after each write to avoid corrupted state. */
export function mutate<T>(fn: (draft: DbShape) => T): T {
  const d = db();
  const result = fn(d);
  persist(d);
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

/**
 * Reset the store entirely (used by tests / admin "reset demo data").
 * In-memory cache is cleared so the next read reloads from disk.
 */
export function resetDb() {
  cache = null;
  ensureDir();
  if (fs.existsSync(DB_FILE)) fs.rmSync(DB_FILE);
}
