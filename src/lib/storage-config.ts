import { createHash } from "node:crypto";
import { cleanConnectionValue } from "./env";
import { RequestError } from "./errors";

type Env = Record<string, string | undefined>;
export function isVercel(env: Env = process.env): boolean {
  return env.VERCEL === "1" || env.VERCEL_ENV === "production" || env.VERCEL_ENV === "preview";
}

/** Select a matching URL/token pair; never mix credentials from two integrations. */
export function redisConnection(env: Env = process.env) {
  const names = cleanConnectionValue(env.UPSTASH_REDIS_REST_URL) || cleanConnectionValue(env.UPSTASH_REDIS_REST_TOKEN)
    ? ["UPSTASH_REDIS_REST_URL", "UPSTASH_REDIS_REST_TOKEN"]
    : cleanConnectionValue(env.KV_REST_API_URL) || cleanConnectionValue(env.KV_REST_API_TOKEN)
      ? ["KV_REST_API_URL", "KV_REST_API_TOKEN"]
      : ["UPSTASH_REDIS_REST_URL", "UPSTASH_REDIS_REST_TOKEN"];
  const url = cleanConnectionValue(env[names[0]]);
  const token = cleanConnectionValue(env[names[1]]);
  return { url, token, configured: !!(url && token), partial: !!(url || token), missing: names.filter((name) => !cleanConnectionValue(env[name])) };
}

function previewBranch(env: Env): string {
  const branch = env.VERCEL_GIT_COMMIT_REF || env.VERCEL_BRANCH_URL || "preview";
  return `${branch.replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 80)}-${createHash("sha256").update(branch).digest("hex").slice(0, 8)}`;
}

/** Production keeps the existing key; previews cannot reset real user accounts. */
export function redisDbKey(env: Env = process.env): string {
  return cleanConnectionValue(env.REDIS_DB_KEY) || (env.VERCEL_ENV === "preview" ? `app:preview:${previewBranch(env)}:db` : "app:db");
}

export function blobPrefix(env: Env = process.env): string {
  return env.VERCEL_ENV === "preview" ? `uploads/preview/${previewBranch(env)}` : "uploads";
}

export function missingStorageEnvironment(env: Env = process.env): string[] {
  return [...redisConnection(env).missing, ...(!cleanConnectionValue(env.BLOB_READ_WRITE_TOKEN) ? ["BLOB_READ_WRITE_TOKEN"] : [])];
}

export function assertDurableDatabase(): void {
  const redis = redisConnection();
  if ((isVercel() || redis.partial) && !redis.configured) {
    throw new RequestError("database_not_configured", `Постоянная база не подключена. Добавьте ${redis.missing.join(" и ")} в Vercel и выполните Redeploy.`, 503);
  }
}

export function assertDurableUploads(): void {
  if (isVercel() && !cleanConnectionValue(process.env.BLOB_READ_WRITE_TOKEN)) {
    throw new RequestError("blob_not_configured", "Постоянное хранилище фото не подключено. Подключите публичный Vercel Blob (BLOB_READ_WRITE_TOKEN) и выполните Redeploy.", 503);
  }
}
