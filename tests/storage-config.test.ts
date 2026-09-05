import { test } from "node:test";
import assert from "node:assert/strict";
import { blobPrefix, redisConnection, redisDbKey } from "../src/lib/storage-config";

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
