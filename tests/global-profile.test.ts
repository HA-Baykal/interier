import { after, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { isolateStorage, TEST_USER } from "./helpers";

let cleanup: () => void;
let db: typeof import("../src/lib/db");
let config: typeof import("../src/lib/config");
let settings: typeof import("../src/lib/generation/settings");
let admin: typeof import("../src/lib/admin-settings");
let route: typeof import("../src/app/api/admin/generation-profile/route");
before(async () => {
  cleanup = isolateStorage();
  db = await import("../src/lib/db");
  config = await import("../src/lib/config");
  settings = await import("../src/lib/generation/settings");
  admin = await import("../src/lib/admin-settings");
  route = await import("../src/app/api/admin/generation-profile/route");
});
beforeEach(async () => {
  await db.resetDb(); await config.ensureSeeded();
  await config.setSetting("compatible_api_key", "sk_global_private_fixture");
  await db.mutate(d => {
    d.users.push({ ...TEST_USER });
    d.sessions.push({ token: "global-profile-session", userId: TEST_USER.id, createdAt: Date.now(), expiresAt: Date.now() + 60000 });
  });
});
after(() => cleanup());
function request(profileId: string, origin = "https://app.example.test", token = "global-profile-session") {
  return new NextRequest("https://app.example.test/api/admin/generation-profile", {
    method: "PUT", headers: { "Content-Type": "application/json", Origin: origin, "x-session-token": token }, body: JSON.stringify({ profileId }),
  });
}

test("the unchanged public model now defaults to GPT Image 2 Low", async () => {
  const resolved = await settings.getGenerationSettings();
  assert.equal(resolved.compatible.model, "gpt-image-2");
  assert.equal(resolved.compatible.quality, "low");
  assert.equal(admin.adminSettingsView(await db.db()).active_profile, "gpt-image-2:low");
});

test("applying Nano changes the server-wide model, not only one request; switching back stores the chosen quality", async (t) => {
  t.mock.method(globalThis, "fetch", async () => { throw new Error("Saving a setting must not call GenAPI"); });
  const response = await route.PUT(request("nano-banana:standard"));
  assert.equal(response.status, 200);
  const text = await response.text();
  assert.ok(!text.includes("sk_global_private_fixture"));
  const saved = await settings.getGenerationSettings();
  assert.equal(saved.compatible.model, "nano-banana");
  assert.equal(saved.compatible.quality, undefined);
  assert.equal((await db.db()).generations.length, 0);
  await admin.activateGenApiProfile("gpt-image-2:high");
  assert.equal((await settings.getGenerationSettings()).compatible.quality, "high");
  await admin.activateGenApiProfile("gpt-image-2:low");
  assert.equal((await settings.getGenerationSettings()).compatible.quality, "low");
  const again = await db.db();
  assert.equal(again.settings.find(item => item.key === "compatible_quality")?.value, "low");
});

test("an isolated lab test does not replace the global model", async () => {
  await admin.activateGenApiProfile("nano-banana-pro:2k");
  const base = await settings.getGenerationSettings();
  const { generationRequestSettings } = await import("../src/lib/generation/request-settings");
  const selected = generationRequestSettings(base, true, { scope: "single", testProfile: "gpt-image-2:medium" });
  assert.equal(selected.compatible.model, "gpt-image-2");
  assert.equal(selected.compatible.quality, "medium");
  assert.equal((await settings.getGenerationSettings()).compatible.model, "nano-banana-pro");
  assert.equal((await settings.getGenerationSettings()).compatible.resolution, "2K");
});

test("a global change preserves the effective environment endpoint and never copies the environment key into the database", async (t) => {
  await config.setSetting("compatible_api_key", "");
  process.env.COMPATIBLE_API_KEY = "sk_environment_private_fixture";
  process.env.COMPATIBLE_BASE_URL = "https://configured-proxy.example.test";
  t.after(() => { delete process.env.COMPATIBLE_API_KEY; delete process.env.COMPATIBLE_BASE_URL; });
  const result = await admin.activateGenApiProfile("gpt-image-2:low");
  assert.equal(result.compatible_base_url, "https://configured-proxy.example.test");
  assert.equal(result.compatible_key_source, "environment");
  assert.equal(result.compatible_api_key, "");
  assert.ok(!(await db.db()).settings.some(item => item.value === "sk_environment_private_fixture"));
});

test("non-admin, anonymous and cross-site requests cannot change the model", async () => {
  assert.equal((await route.PUT(request("gpt-image-2:high", "https://evil.example.test"))).status, 403);
  assert.equal((await route.PUT(request("gpt-image-2:high", "https://app.example.test", ""))).status, 403);
  await db.mutate(d => { d.users[0].isAdmin = false; });
  assert.equal((await route.PUT(request("gpt-image-2:high"))).status, 403);
  assert.equal((await settings.getGenerationSettings()).compatible.quality, "low");
});

test("invalid profiles cannot partially change settings or repurpose a different provider's key", async () => {
  const before = JSON.stringify((await db.db()).settings);
  await assert.rejects(admin.activateGenApiProfile("invented"), /списка/);
  assert.equal(JSON.stringify((await db.db()).settings), before);
  await config.setSetting("compatible_provider", "openai-compatible");
  await assert.rejects(admin.activateGenApiProfile("nano-banana:standard"), /другого провайдера/);
  assert.equal((await settings.getGenerationSettings()).compatible.provider, "openai-compatible");
});
