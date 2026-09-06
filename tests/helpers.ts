import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/** Never touch a real database/provider, even when tests run with cloud env vars. */
export function isolateStorage() {
  const cwd = process.cwd();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "interier-test-"));
  const env = { ...process.env };
  for (const key of Object.keys(process.env)) {
    if (/^(UPSTASH_|KV_|BLOB_|VERCEL|COMPATIBLE_|GENERATION_MODE|REPLICATE_|REDIS_DB_KEY|DATABASE_PATH|ADMIN_)/.test(key)) delete process.env[key];
  }
  process.env.DATABASE_PATH = path.join(dir, "app.json");
  process.chdir(dir);
  return () => {
    process.chdir(cwd);
    process.env = env;
    fs.rmSync(dir, { recursive: true, force: true });
  };
}

export const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a2Z8AAAAASUVORK5CYII=", "base64");
export const TEST_USER = {
  id: "usr_test", email: "test@example.test", passwordHash: "unused", name: "Test", createdAt: 1,
  credits: 3, trialUsed: false, telegramId: null, telegramUsername: null, vkId: null, vkUsername: null,
  referralCode: "TEST1234", referredBy: null, isAdmin: true, identityVerifiedAt: 1, identityVerifiedBy: "email" as const,
};
