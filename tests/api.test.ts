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
  (await import("../src/lib/security-store")).resetSecurityMemoryForTests();
  await store.resetDb();
  await seed.ensureSeeded();
  await store.mutate((d) => {
    d.users.push({ ...TEST_USER });
    d.sessions.push({ token: "test-session", userId: TEST_USER.id, createdAt: Date.now(), expiresAt: Date.now() + 60000 });
  });
});
after(() => cleanup());
function request(scope = "single", quality?: string, testProfile?: string) {
  const body = new FormData();
  body.set("file", new File([PNG], "room.png", { type: "image/png" }));
  body.set("styleId", "style_modern");
  body.set("scope", scope);
  if (quality !== undefined) body.set("quality", quality);
  if (testProfile !== undefined) body.set("testProfile", testProfile);
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


test("a 50 RUB provider fixture accepts an admin medium test and keeps the site default at low", async (t) => {
  await seed.setSetting("compatible_api_key", "sk_quality_test");
  await seed.setSetting("test_unlimited", "0");
  const before = JSON.stringify((await store.db()).settings);
  let balance = 50; // Synthetic provider billing only. No real paid requests.
  const qualities: string[] = [];
  t.mock.method(globalThis, "fetch", async (url: string, init?: RequestInit) => {
    if (init?.method === "POST") {
      assert.equal(url, "https://api.gen-api.ru/api/v1/networks/gpt-image-2");
      const payload = JSON.parse(String(init.body));
      qualities.push(payload.quality);
      assert.equal(payload.image_size, "1024x1024");
      assert.equal(payload.num_images, 1);
      assert.equal(payload.output_format, "png");
      const cost = payload.quality === "low" ? 2.5 : payload.quality === "medium" ? 15 : 55;
      if (balance < cost) return Response.json({ error: "Недостаточно средств" }, { status: 402 });
      balance -= cost;
      return Response.json({ request_id: 701 });
    }
    if (url.includes("/request/get/")) return Response.json({ status: "success", result: ["https://result.example.test/medium.png"] });
    assert.equal(url, "https://result.example.test/medium.png");
    return new Response(new Uint8Array(PNG), { headers: { "Content-Type": "image/png" } });
  });
  const medium = await (await generate.POST(request("single", "medium"))).json();
  assert.equal(medium.generations[0].status, "done");
  assert.equal(medium.generations[0].quality, "medium");
  assert.equal(medium.isDemo, false);
  assert.equal(balance, 35);
  assert.equal((await store.db()).generations[0].quality, "medium");
  const history = await import("../src/app/api/generations/route");
  const req = new NextRequest("https://app.example.test/api/generations", { headers: { "x-session-token": "test-session" } });
  const list = await (await history.GET(req)).json();
  assert.equal(list.generations[0].quality, "medium");
  assert.equal(list.generations[0].resultUrl, medium.generations[0].resultUrl);
  // Omission uses the site-wide Low; an isolated Medium test must not change it.
  const legacy = await (await generate.POST(request())).json();
  assert.equal(legacy.generations[0].quality, "low");
  assert.equal(legacy.generations[0].status, "done");
  assert.deepEqual(qualities, ["medium", "low"]);
  assert.equal(balance, 32.5);
  assert.equal(JSON.stringify((await store.db()).settings), before);
});

test("empty and unknown quality values are rejected, not silently upgraded to high", async (t) => {
  await seed.setSetting("compatible_api_key", "sk_quality_test");
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => { calls++; throw new Error("Must not call a paid provider"); });
  for (const quality of ["", "invalid", "HIGH", "ultra", "null"]) {
    const res = await generate.POST(request("single", quality));
    assert.equal(res.status, 400);
    assert.equal((await res.json()).error, "bad_request");
  }
  assert.equal(calls, 0);
  assert.equal((await store.db()).generations.length, 0);
  assert.equal((await store.db()).users[0].trialUsed, false);
});

test("the quality test override requires a real admin, not just a client-side picker", async (t) => {
  await seed.setSetting("compatible_api_key", "sk_quality_test");
  await store.mutate((d) => { d.users[0].isAdmin = false; });
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => { calls++; throw new Error("Must not call a paid provider"); });
  const res = await generate.POST(request("single", "medium"));
  assert.equal(res.status, 403);
  assert.equal((await res.json()).error, "quality_forbidden");
  assert.equal(calls, 0);
  assert.equal((await store.db()).generations.length, 0);
});

test("a stale quality picker cannot override another model or a deliberately selected demo mode", async (t) => {
  await seed.setSetting("compatible_api_key", "sk_quality_test");
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => { calls++; throw new Error("Must not call a paid provider"); });
  await seed.setSetting("compatible_model", "nano-banana-pro");
  let res = await generate.POST(request("single", "medium"));
  assert.equal(res.status, 400);
  assert.equal((await res.json()).error, "quality_not_supported");
  await seed.setSetting("generation_mode", "demo");
  await seed.setSetting("generation_mode_explicit", "1");
  res = await generate.POST(request("single", "medium"));
  assert.equal(res.status, 400);
  assert.equal((await res.json()).error, "quality_not_supported");
  assert.equal(calls, 0);
  assert.equal((await store.db()).generations.length, 0);
});

test("an explicit high choice is honored and a provider refusal never retries at a different quality", async (t) => {
  await seed.setSetting("compatible_api_key", "sk_quality_test");
  let calls = 0;
  t.mock.method(globalThis, "fetch", async (_: string, init: RequestInit) => {
    calls++;
    assert.equal(JSON.parse(String(init.body)).quality, "high");
    return Response.json({ error: "Недостаточно средств" }, { status: 402 });
  });
  const body = await (await generate.POST(request("single", "high"))).json();
  assert.equal(body.generations[0].quality, "high");
  assert.equal(body.generations[0].status, "failed");
  assert.equal(calls, 1);
});


test("admin model tests use Nano's own payload, record the estimate, and leave the public demo/settings unchanged", async (t) => {
  await seed.setSetting("compatible_api_key", "sk_private_model_lab");
  await seed.setSetting("generation_mode", "demo");
  await seed.setSetting("generation_mode_explicit", "1");
  const before = JSON.stringify((await store.db()).settings);
  let starts = 0;
  t.mock.method(globalThis, "fetch", async (url: string, init?: RequestInit) => {
    // The shopping-list detector may call the vision endpoint; it is a different
    // (free-ish, non-generation) API, so only paid network renders are counted.
    if (init?.method === "POST" && !url.includes("/v1/chat/completions")) {
      starts++;
      assert.equal(url, "https://api.gen-api.ru/api/v1/networks/nano-banana");
      const payload = JSON.parse(String(init.body));
      assert.equal(payload.num_images, 1);
      assert.equal(payload.translate_input, false);
      assert.equal(payload.aspect_ratio, "default");
      for (const key of ["quality", "image_size", "resolution", "callback_url"]) assert.equal(Object.hasOwn(payload, key), false);
      return Response.json({ request_id: 900 });
    }
    if (url.includes("/request/get/")) return Response.json({ status: "success", result: ["https://result.example.test/nano.png"] });
    if (init?.method === "POST") return Response.json({ choices: [{ message: { content: "" } }] });
    return new Response(new Uint8Array(PNG));
  });
  const res = await generate.POST(request("single", undefined, "nano-banana:standard"));
  const data = await res.json();
  assert.equal(res.status, 200);
  assert.equal(data.isDemo, false);
  const item = data.generations[0];
  assert.equal(item.provider, "nano-banana");
  assert.equal(item.testProfile, "nano-banana:standard");
  assert.equal(item.quality, undefined);
  assert.equal(item.estimatedCostRub, 9.75);
  assert.equal(item.status, "done");
  assert.ok(item.durationMs >= 0);
  assert.equal(starts, 1);
  assert.ok(!JSON.stringify(data).includes("sk_private_model_lab"));
  assert.equal(JSON.stringify((await store.db()).settings), before);
  assert.equal((await store.db()).generations[0].testProfile, item.testProfile);
  const normal = await (await generate.POST(request())).json();
  assert.equal(normal.isDemo, true);
  assert.equal(starts, 1);
});

test("ordinary users cannot invoke an admin test, even with unlimited testing enabled", async (t) => {
  await seed.setSetting("compatible_api_key", "sk_model_lab");
  await store.mutate(d => { d.users[0].isAdmin = false; });
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => { calls++; throw new Error("Must not call provider"); });
  const res = await generate.POST(request("single", undefined, "gpt-image-2:low"));
  assert.equal(res.status, 403);
  assert.equal((await res.json()).error, "test_profile_forbidden");
  assert.equal(calls, 0);
  assert.equal((await store.db()).generations.length, 0);
});

test("unknown, bulk and conflicting model tests fail before a paid request", async (t) => {
  await seed.setSetting("compatible_api_key", "sk_model_lab");
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => { calls++; throw new Error("Must not call provider"); });
  for (const req of [request("single", undefined, "unknown"), request("all", undefined, "gpt-image-2:low"), request("single", "high", "nano-banana:standard")]) {
    assert.equal((await generate.POST(req)).status, 400);
  }
  assert.equal(calls, 0);
  assert.equal((await store.db()).generations.length, 0);
});

test("a direct Nano/WebP request is rejected before upload, reservation or provider charging", async (t) => {
  await seed.setSetting("compatible_api_key", "sk_model_lab");
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => { calls++; throw new Error("Must not call provider"); });
  const body = new FormData();
  body.set("file", new File([Buffer.from("RIFF0000WEBP")], "image.webp", { type: "image/webp" }));
  body.set("styleId", "style_modern"); body.set("scope", "single"); body.set("testProfile", "nano-banana:standard");
  const res = await generate.POST(new NextRequest("https://app.example.test/api/generate", { method: "POST", headers: { "x-session-token": "test-session" }, body }));
  assert.equal(res.status, 400);
  assert.equal((await res.json()).error, "model_image_type");
  assert.equal(calls, 0);
  assert.equal((await store.db()).generations.length, 0);
});

test("failed free starts consume the rolling image budget and cannot be retried into unlimited upstream spending", async (t) => {
  await seed.setSetting("compatible_api_key", "sk_free_budget_fixture");
  await seed.setSetting("daily_free_image_limit", "1");
  await store.mutate(d => { d.users[0].isAdmin = false; d.users[0].credits = 0; });
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => { calls++; return Response.json({ error: "upstream temporarily unavailable" }, { status: 503 }); });
  const first = await (await generate.POST(request())).json();
  assert.equal(first.generations[0].status, "failed");
  assert.equal((await store.db()).generations[0].freeBudgeted, true);
  assert.equal((await store.db()).users[0].trialUsed, false, "the personal trial is refundable, not the global safety budget");
  const retry = await generate.POST(request());
  assert.equal(retry.status, 429);
  assert.equal((await retry.json()).error, "free_budget_exhausted");
  assert.equal(calls, 1);
});
