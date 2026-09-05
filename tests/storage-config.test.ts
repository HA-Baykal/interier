import { test } from "node:test";
import assert from "node:assert/strict";
import { blobPrefix, redisConnection, redisDbKey, blobAuthOptions, blobAuthentication, missingStorageEnvironment } from "../src/lib/storage-config";

test("Redis supports Upstash and legacy KV names without mixing different credentials", () => {
  const upstash = redisConnection({ UPSTASH_REDIS_REST_URL: '"https://db.upstash.io"\r', UPSTASH_REDIS_REST_TOKEN: " 'my_token' " });
  assert.equal(upstash.url, "https://db.upstash.io");
  assert.equal(upstash.token, "my_token");
  assert.equal(upstash.configured, true);
  assert.equal(redisConnection({ KV_REST_API_URL: "https://kv.upstash.io", KV_REST_API_TOKEN: "token" }).configured, true);
  const mixed = redisConnection({ UPSTASH_REDIS_REST_URL: "https://upstash.io", KV_REST_API_TOKEN: "wrong_db_token" });
  assert.equal(mixed.configured, false);
  assert.deepEqual(mixed.missing, ["UPSTASH_REDIS_REST_TOKEN"]);
});

test("preview storage is stable across deploys but isolated from production and other branches", () => {
  const preview = { VERCEL_ENV: "preview", VERCEL_GIT_COMMIT_REF: "arena/01a070c8-interier" };
  assert.equal(redisDbKey({ VERCEL_ENV: "production" }), "app:db");
  assert.notEqual(redisDbKey(preview), "app:db");
  assert.equal(redisDbKey(preview), redisDbKey({ ...preview, VERCEL_GIT_COMMIT_SHA: "new-sha" }));
  assert.notEqual(redisDbKey(preview), redisDbKey({ ...preview, VERCEL_GIT_COMMIT_REF: "main" }));
  assert.notEqual(blobPrefix(preview), blobPrefix({ VERCEL_ENV: "production" }));
  assert.equal(redisDbKey({ ...preview, REDIS_DB_KEY: "isolated:test:db" }), "isolated:test:db");
});


test("a linked Blob store uses managed OIDC without a read/write token", () => {
  const env = {
    VERCEL: "1", VERCEL_ENV: "preview",
    BLOB_STORE_ID: ' "store_linked"\r\n ', BLOB_WEBHOOK_PUBLIC_KEY: "public-verification-key",
    KV_REST_API_URL: "https://db.example.test", KV_REST_API_TOKEN: "redis-test-token",
  };
  assert.equal(blobAuthentication(env), "oidc");
  assert.deepEqual(blobAuthOptions(env), { storeId: "store_linked" });
  assert.deepEqual(missingStorageEnvironment(env), []);
});

test("SDK auth options never copy or pin the runtime OIDC credential", () => {
  const env = { BLOB_STORE_ID: "store_linked", VERCEL_OIDC_TOKEN: "first-runtime-token" };
  assert.deepEqual(blobAuthOptions(env), { storeId: "store_linked" });
  env.VERCEL_OIDC_TOKEN = "rotated-runtime-token";
  assert.deepEqual(blobAuthOptions(env), { storeId: "store_linked" });
  assert.ok(!JSON.stringify(blobAuthOptions(env)).includes("runtime-token"));
});

test("legacy read/write tokens retain precedence and are cleaned", () => {
  const env = { BLOB_STORE_ID: "store_linked", BLOB_READ_WRITE_TOKEN: ' "legacy-token"\r ' };
  assert.equal(blobAuthentication(env), "token");
  assert.deepEqual(blobAuthOptions(env), { token: "legacy-token" });
});

test("a webhook verification key or OIDC token alone is not a Blob connection", () => {
  const env = { VERCEL: "1", BLOB_WEBHOOK_PUBLIC_KEY: "not-an-upload-credential", VERCEL_OIDC_TOKEN: "runtime-token" };
  assert.equal(blobAuthentication(env), "unconfigured");
  assert.deepEqual(blobAuthOptions(env), {});
  assert.ok(missingStorageEnvironment(env).includes("BLOB_STORE_ID"));
  assert.equal(blobAuthentication({ BLOB_STORE_ID: ' "  " ', BLOB_READ_WRITE_TOKEN: " \r\n" }), "unconfigured");
});
