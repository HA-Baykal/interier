import { after, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { isolateStorage, PNG, TEST_USER } from "./helpers";

let cleanup: () => void;
let store: typeof import("../src/lib/db");
let seed: typeof import("../src/lib/config");
let generate: typeof import("../src/app/api/generate/route");
let genstatus: typeof import("../src/app/api/admin/genstatus/route");
let settings: typeof import("../src/app/api/admin/settings/route");
before(async () => {
  cleanup = isolateStorage();
  store = await import("../src/lib/db");
  seed = await import("../src/lib/config");
  generate = await import("../src/app/api/generate/route");
  genstatus = await import("../src/app/api/admin/genstatus/route");
  settings = await import("../src/app/api/admin/settings/route");
});
beforeEach(async () => {
  await store.resetDb();
  await seed.ensureSeeded();
  await store.mutate((d) => {
    d.users.push({ ...TEST_USER });
    d.sessions.push({ token: "test-session", userId: TEST_USER.id, createdAt: Date.now(), expiresAt: Date.now() + 60000 });
  });
});
after(() => cleanup());
function request(scope = "single") {
  const body = new FormData();
  body.set("file", new File([PNG], "room.png", { type: "image/png" }));
  body.set("styleId", "style_modern");
  body.set("scope", scope);
  return new NextRequest("https://app.example.test/api/generate", { method: "POST", headers: { "x-session-token": "test-session" }, body });
}

test("generation endpoint declares a 300-second Vercel budget", () => { assert.equal(generate.maxDuration, 300); });

test("demo stores its result, while an explicit real mode without a key fails early", async () => {
  const res = await generate.POST(request());
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.equal(body.isDemo, true);
  assert.equal(body.generations[0].status, "done");
  assert.equal((await store.db()).generations[0].resultUrl, body.generations[0].originalUrl);
  await seed.setSetting("generation_mode", "compatible");
  const fail = await generate.POST(request());
  assert.equal(fail.status, 503);
  assert.equal((await fail.json()).error, "ai_not_configured");
});

test("provider failure is visible, not replaced with a demo image, and trial is refunded", async (t) => {
  await seed.setSetting("compatible_api_key", "sk_failure_test");
  await seed.setSetting("test_unlimited", "0");
  t.mock.method(globalThis, "fetch", async () => Response.json({ error: "invalid api key" }, { status: 401 }));
  const res = await generate.POST(request());
  const body = await res.json();
  assert.equal(body.isDemo, false);
  assert.equal(body.generations[0].status, "failed");
  assert.equal(body.generations[0].resultUrl, null);
  assert.match(body.generations[0].note, /GenAPI start failed \(401\)/);
  const d = await store.db();
  assert.equal(d.users[0].trialUsed, false);
  assert.match(d.generations[0].error!, /401/);
});

test("all-style jobs run concurrently and successful images are saved, not left on provider URLs", async (t) => {
  await seed.setSetting("compatible_api_key", "sk_success_test");
  let starts = 0;
  const count = (await seed.activeStyles()).length;
  t.mock.method(globalThis, "fetch", async (url: string, init?: RequestInit) => {
    if (init?.method === "POST") { starts++; return Response.json({ request_id: starts }); }
    if (url.includes("/request/get/")) {
      assert.equal(starts, count, "all starts happen before the first poll");
      return Response.json({ status: "success", result: ["https://result.example.test/image.png"] });
    }
    return new Response(new Uint8Array(PNG), { headers: { "Content-Type": "image/png" } });
  });
  const res = await generate.POST(request("all"));
  const body = await res.json();
  assert.equal(body.generations.length, count);
  assert.ok(body.generations.every((g: { status: string; resultUrl: string; originalUrl: string }) => g.status === "done" && g.resultUrl.startsWith("/api/uploads/") && g.resultUrl !== g.originalUrl));
  assert.equal((await store.db()).generations.filter((g) => g.status === "done").length, count);
});

test("genstatus and settings require admin; diagnostics never expose a saved key", async () => {
  const unauthorized = new NextRequest("https://app.example.test/api/admin/genstatus?probe=1");
  assert.equal((await genstatus.GET(unauthorized)).status, 403);
  assert.equal((await settings.GET(unauthorized)).status, 403);
  await seed.setSetting("compatible_api_key", "sk_hidden_test");
  const req = new NextRequest("https://app.example.test/api/admin/genstatus", { headers: { "x-session-token": "test-session" } });
  const res = await genstatus.GET(req);
  assert.equal(res.status, 200);
  assert.match(res.headers.get("cache-control")!, /no-store/);
  const text = await res.text();
  assert.ok(!text.includes("sk_hidden_test"));
  assert.equal(JSON.parse(text).keyConfigured, true);
  await store.mutate((d) => { d.users[0].isAdmin = false; });
  assert.equal((await genstatus.GET(req)).status, 403);
});

test("Vercel refuses ephemeral accounts/settings/generation and explains missing variables", async (t) => {
  process.env.VERCEL = "1";
  t.after(() => { delete process.env.VERCEL; });
  t.mock.method(globalThis, "fetch", async () => { throw new Error("Must not contact a paid provider"); });
  const res = await generate.POST(request());
  assert.equal(res.status, 503);
  assert.match((await res.json()).message, /UPSTASH_REDIS_REST/);
  const login = await import("../src/app/api/auth/login/route");
  const register = await import("../src/app/api/auth/register/route");
  assert.equal((await login.POST(request())).status, 503);
  assert.equal((await register.POST(request())).status, 503);
  const admin = await import("../src/lib/admin-settings");
  await assert.rejects(admin.updateAdminSettings({ compatible_api_key: "dont-lose-me" }), /UPSTASH_REDIS_REST/);
});


test("bootstrap recognizes a linked OIDC Blob store without disclosing runtime credentials", async (t) => {
  process.env.BLOB_STORE_ID = "store_linked";
  process.env.VERCEL_OIDC_TOKEN = "runtime-secret-must-not-be-returned";
  t.after(() => { delete process.env.BLOB_STORE_ID; delete process.env.VERCEL_OIDC_TOKEN; });
  const bootstrap = await import("../src/app/api/admin/bootstrap/route");
  const res = await bootstrap.GET();
  assert.equal(res.status, 200);
  const text = await res.text();
  const body = JSON.parse(text);
  assert.equal(body.uploads, "blob");
  assert.equal(body.blobAuthentication, "oidc");
  assert.ok(!body.missingEnvironment.some((name: string) => name.startsWith("BLOB_")));
  assert.ok(!text.includes("runtime-secret-must-not-be-returned"));
});


test("admin probe reports an unverified connection timeout, its region and healthy storage without leaking a key", async (t) => {
  process.env.VERCEL_REGION = "iad1";
  t.after(() => { delete process.env.VERCEL_REGION; });
  const key = "sk_private_network_test";
  await seed.setSetting("compatible_api_key", key);
  let calls = 0;
  t.mock.method(globalThis, "fetch", async (url: string, init: RequestInit) => {
    calls++;
    assert.equal(url, "https://api.gen-api.ru/api/v1/user");
    assert.equal(init.method, "GET");
    throw new TypeError(`fetch failed with ${key}`, { cause: Object.assign(new Error(key), { code: "UND_ERR_CONNECT_TIMEOUT" }) });
  });
  const req = new NextRequest("https://app.example.test/api/admin/genstatus?probe=1", { headers: { "x-session-token": "test-session" } });
  const res = await genstatus.GET(req);
  const text = await res.text();
  const data = JSON.parse(text);
  assert.equal(res.status, 200);
  assert.match(res.headers.get("cache-control")!, /no-store/);
  assert.equal(data.deployment.region, "iad1");
  assert.equal(data.probe.code, "timeout");
  assert.equal(data.probe.keyAccepted, null);
  assert.equal(data.probe.networkCode, "UND_ERR_CONNECT_TIMEOUT");
  assert.equal(data.probe.attempts, 2);
  assert.equal(calls, 2);
  assert.equal(data.storageChecks.database.ok, true);
  assert.equal(data.storageChecks.uploads.ok, true);
  assert.ok(!text.includes(key));
});


test("422 validation details reach the UI and history, with no demo substitute, duplicate request or spent trial", async (t) => {
  await seed.setSetting("compatible_api_key", "sk_422_fixture");
  await seed.setSetting("test_unlimited", "0");
  let calls = 0;
  t.mock.method(globalThis, "fetch", async (_: string, init: RequestInit) => {
    calls++;
    assert.equal(init.method, "POST");
    assert.equal(Object.hasOwn(JSON.parse(String(init.body)), "callback_url"), false);
    return Response.json({ error: true, errors: { image_urls: ["Unsupported image input"] }, code: "invalid_parameter" }, { status: 422 });
  });
  const res = await generate.POST(request());
  const body = await res.json();
  assert.equal(body.isDemo, false);
  assert.equal(body.generations[0].status, "failed");
  assert.equal(body.generations[0].resultUrl, null);
  assert.match(body.generations[0].note, /image_urls.*Unsupported image input/);
  assert.ok(!body.generations[0].note.includes(": true"));
  assert.equal(calls, 1);
  const d = await store.db();
  assert.equal(d.users[0].trialUsed, false);
  assert.match(d.generations[0].error!, /invalid_parameter/);
});
