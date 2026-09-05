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

/**
 * Keep existing explicit read/write tokens working. A linked BLOB_STORE_ID alone
 * uses Vercel's managed OIDC credentials (from the runtime/request context).
 * Never read/cache/pass oidcToken here: the SDK must refresh it per operation.
 */
export function blobAuthOptions(env: Env = process.env): { token?: string; storeId?: string } {
  const token = cleanConnectionValue(env.BLOB_READ_WRITE_TOKEN);
  if (token) return { token };
  const storeId = cleanConnectionValue(env.BLOB_STORE_ID);
  return storeId ? { storeId } : {};
}

/** Configuration only, NOT a claim that a live write has succeeded. */
export function blobAuthentication(env: Env = process.env): "token" | "oidc" | "unconfigured" {
  const options = blobAuthOptions(env);
  return options.token ? "token" : options.storeId ? "oidc" : "unconfigured";
}

export function missingStorageEnvironment(env: Env = process.env): string[] {
  const missingBlob = blobAuthentication(env) === "unconfigured"
    ? [isVercel(env) ? "BLOB_STORE_ID" : "BLOB_READ_WRITE_TOKEN"] : [];
  return [...redisConnection(env).missing, ...missingBlob];
}

export function assertDurableDatabase(): void {
  const redis = redisConnection();
  if ((isVercel() || redis.partial) && !redis.configured) {
    throw new RequestError("database_not_configured", `Постоянная база не подключена. Добавьте ${redis.missing.join(" и ")} в Vercel и выполните Redeploy.`, 503);
  }
}

export function assertDurableUploads(): void {
  if (isVercel() && blobAuthentication() === "unconfigured") {
    throw new RequestError("blob_not_configured", "Постоянное хранилище фото не подключено. Подключите публичный Vercel Blob к проекту (BLOB_STORE_ID или BLOB_READ_WRITE_TOKEN) и выполните Redeploy.", 503);
  }
}
