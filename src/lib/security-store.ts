import { createHash } from "node:crypto";
import type { NextRequest } from "next/server";
import { getRedis } from "./db";
import { assertDurableDatabase, redisConnection, redisDbKey } from "./storage-config";
import { RequestError } from "./errors";

// Small TTL records live outside the large accounts/history document.
// Local memory is only for development/tests; Vercel always requires Redis.
type Envelope<T> = { value: T; expiresAt: number };
const local = new Map<string, Envelope<unknown>>();
const counters = new Map<string, { count: number; expiresAt: number }>();
export function securityNamespace(): string {
  return redisConnection().configured ? redisDbKey() : `local:${createHash("sha256").update(process.env.DATABASE_PATH || process.cwd()).digest("hex").slice(0, 16)}`;
}
function keyFor(key: string) { return `${securityNamespace()}:security:${key}`; }
function decode<T>(raw: unknown): Envelope<T> | null {
  if (raw === null || raw === undefined) return null;
  let parsed: unknown;
  try { parsed = typeof raw === "string" ? JSON.parse(raw) : raw; } catch { throw new RequestError("auth_storage_invalid", "Временное хранилище входа недоступно.", 503); }
  if (!parsed || typeof parsed !== "object" || !("expiresAt" in parsed) || typeof parsed.expiresAt !== "number" || !("value" in parsed)) throw new RequestError("auth_storage_invalid", "Временное хранилище входа недоступно.", 503);
  return parsed as Envelope<T>;
}
export async function getSecurityDocument<T>(key: string): Promise<T | null> {
  assertDurableDatabase();
  const full = keyFor(key);
  const item = redisConnection().configured ? decode<T>(await (await getRedis()).get(full)) : local.get(full) as Envelope<T> | undefined;
  if (!item || item.expiresAt <= Date.now()) { local.delete(full); return null; }
  return structuredClone(item.value);
}
const CAS = `local old=redis.call('GET',KEYS[1]); if (not old and ARGV[1]=='') or old==ARGV[1] then redis.call('SET',KEYS[1],ARGV[2],'PX',ARGV[3]); return 1 end; return 0`;
export async function mutateSecurityDocument<T, R>(key: string, fn: (value: T | null) => { value: T; expiresAt: number; result: R }): Promise<R> {
  assertDurableDatabase();
  const full = keyFor(key);
  if (!redisConnection().configured) {
    const old = local.get(full);
    const next = fn(old && old.expiresAt > Date.now() ? structuredClone(old.value as T) : null);
    local.set(full, { value: structuredClone(next.value), expiresAt: next.expiresAt });
    return next.result;
  }
  const client = await getRedis();
  for (let attempt = 0; attempt < 8; attempt++) {
    const raw = await client.get<string>(full);
    const old = decode<T>(raw);
    const next = fn(old && old.expiresAt > Date.now() ? old.value : null);
    const ttl = Math.max(1, Math.min(15 * 60_000, next.expiresAt - Date.now()));
    const encoded = JSON.stringify({ value: next.value, expiresAt: next.expiresAt });
    if (await client.eval<string[], number>(CAS, [full], [raw ?? "", encoded, String(ttl)]) === 1) return next.result;
  }
  throw new RequestError("auth_busy", "Вход обрабатывается. Повторите через несколько секунд.", 503);
}
const LIMIT = `local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('PEXPIRE',KEYS[1],ARGV[1]) end; return n`;
export async function enforceRateLimit(scope: string, bucket: string, limit: number, windowMs: number): Promise<void> {
  assertDurableDatabase();
  const full = keyFor(`limit:${createHash("sha256").update(`${scope}:${bucket}`).digest("hex")}`);
  let count: number;
  if (redisConnection().configured) count = await (await getRedis()).eval<string[], number>(LIMIT, [full], [String(windowMs)]);
  else {
    const old = counters.get(full);
    const entry = old && old.expiresAt > Date.now() ? old : { count: 0, expiresAt: Date.now() + windowMs };
    entry.count++; counters.set(full, entry); count = entry.count;
    // Keep the development fallback bounded too.
    if (counters.size > 1000) for (const [key, value] of counters) if (value.expiresAt <= Date.now()) counters.delete(key);
  }
  if (count > limit) throw new RequestError("rate_limited", "Слишком много попыток. Подождите несколько минут.", 429);
}
export function requestClientBucket(req: NextRequest): string {
  // Vercel overwrites these at its edge. Raw IPs are never stored or returned.
  return req.headers.get("x-vercel-forwarded-for")?.split(",")[0].trim()
    || req.headers.get("x-forwarded-for")?.split(",")[0].trim() || "local-or-unknown";
}
export function resetSecurityMemoryForTests() {
  if (process.env.NODE_ENV === "production") throw new Error("Test reset is unavailable in production");
  local.clear(); counters.clear();
}
