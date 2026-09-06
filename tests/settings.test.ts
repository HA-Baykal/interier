import { after, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { isolateStorage } from "./helpers";

let cleanup: () => void;
let config: typeof import("../src/lib/generation/settings");
let admin: typeof import("../src/lib/admin-settings");
let store: typeof import("../src/lib/db");
let seed: typeof import("../src/lib/config");
before(async () => {
  cleanup = isolateStorage();
  config = await import("../src/lib/generation/settings");
  admin = await import("../src/lib/admin-settings");
  store = await import("../src/lib/db");
  seed = await import("../src/lib/config");
});
beforeEach(async () => { await store.resetDb(); await seed.ensureSeeded(); });
after(() => cleanup());

test("a newly saved key is cleaned, switches demo to compatible, and is write-only", async () => {
  const view = await admin.updateAdminSettings({ generation_mode: "demo", compatible_api_key: ' " sk_test_123 \r\n" ', compatible_base_url: " 'https://api.gen-api.ru/ ' ", compatible_model: ' "openai/gpt-image-2\r" ' });
  assert.equal(view.generation_mode, "compatible");
  assert.equal(view.compatible_api_key, "");
  assert.equal(view.compatible_configured, true);
  const cfg = await config.getCompatibleConfig();
  assert.equal(cfg?.apiKey, "sk_test_123");
  assert.equal(cfg?.baseUrl, "https://api.gen-api.ru");
  assert.equal(cfg?.model, "gpt-image-2");
  assert.ok(!JSON.stringify(view).includes("sk_test_123"));
});

test("an empty key input keeps the stored secret; deliberately selecting demo works", async () => {
  await admin.updateAdminSettings({ compatible_api_key: "sk_keep" });
  await admin.updateAdminSettings({ compatible_api_key: "", generation_mode: "demo" });
  assert.equal((await config.getCompatibleConfig())?.apiKey, "sk_keep");
  assert.equal(await seed.generationMode(), "demo");
});

test("legacy seeded demo is repaired when a key was already saved", async () => {
  await seed.setSetting("compatible_api_key", '"sk_legacy"');
  assert.equal(await seed.generationMode(), "compatible");
});

test("legacy defaults do not shadow hosting environment configuration", () => {
  const result = config.resolveGenerationSettings([
    { key: "generation_mode", value: "demo" },
    { key: "compatible_provider", value: "genapi" },
    { key: "compatible_base_url", value: "https://api.gen-api.ru" },
    { key: "compatible_model", value: "gpt-image-2" },
  ], { COMPATIBLE_PROVIDER: "openai-compatible", COMPATIBLE_BASE_URL: '"https://api.provod.ai/v1"', COMPATIBLE_API_KEY: "sk_env\r\n", COMPATIBLE_MODEL: "google/nano-banana" });
  assert.equal(result.mode, "compatible");
  assert.equal(result.compatible.provider, "openai-compatible");
  assert.equal(result.compatible.baseUrl, "https://api.provod.ai/v1");
  assert.equal(result.compatible.model, "google/nano-banana");
  assert.equal(result.keySource, "environment");
});

test("invalid configuration is rejected before ANY setting is persisted", async () => {
  const before = await store.db();
  await assert.rejects(admin.updateAdminSettings({ compatible_api_key: "sk_valid", compatible_base_url: "https://user:password@api.gen-api.ru" }), /Invalid AI Base URL/);
  assert.deepEqual(await store.db(), before);
  await assert.rejects(admin.updateAdminSettings({ generation_mode: "invalid" }), /Invalid setting/);
  await assert.rejects(admin.updateAdminSettings([]), /object/);
});
