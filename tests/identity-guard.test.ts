import { after, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { isolateStorage, PNG, TEST_USER } from "./helpers";
import { isIdentityVerified } from "../src/lib/identity";

let cleanup: () => void;
let db: typeof import("../src/lib/db");
let config: typeof import("../src/lib/config");
let generate: typeof import("../src/app/api/generate/route");
let rewards: typeof import("../src/app/api/rewards/verify/route");
before(async () => {
  cleanup = isolateStorage();
  db = await import("../src/lib/db"); config = await import("../src/lib/config");
  generate = await import("../src/app/api/generate/route"); rewards = await import("../src/app/api/rewards/verify/route");
});
beforeEach(async () => {
  await db.resetDb(); await config.ensureSeeded(); await config.setSetting("compatible_api_key", "sk_identity_test");
  await db.mutate(d => {
    d.users.push({ ...TEST_USER, isAdmin: false, identityVerifiedAt: null, identityVerifiedBy: null, credits: 0 });
    d.sessions.push({ token: "identity-session", userId: TEST_USER.id, createdAt: Date.now(), expiresAt: Date.now() + 60000 });
  });
});
after(() => cleanup());
function req(origin = "https://app.example.test") {
  const data = new FormData();
  data.set("file", new File([PNG], "room.png", { type: "image/png" }));
  data.set("styleId", "style_modern"); data.set("scope", "single"); data.set("verified", "true");
  return new NextRequest("https://app.example.test/api/generate", { method: "POST", headers: { "x-session-token": "identity-session", origin }, body: data });
}

test("legacy social IDs, reward flags and self-entered details are not verified identities", () => {
  const legacy = { ...TEST_USER, isAdmin: false, identityVerifiedAt: null, identityVerifiedBy: null, telegramId: 123, vkId: 456 };
  assert.equal(isIdentityVerified(legacy), false);
  assert.equal(isIdentityVerified({ ...legacy, identityVerifiedAt: 1 }), false);
  assert.equal(isIdentityVerified({ ...legacy, identityVerifiedAt: Date.now() + 60000, identityVerifiedBy: "email" }), false);
  assert.equal(isIdentityVerified({ ...legacy, identityVerifiedAt: 1, identityVerifiedBy: "telegram" }), true);
  assert.equal(isIdentityVerified({ ...legacy, isAdmin: true }), true);
});

test("unverified users cannot upload or issue any provider call, even when the client says verified", async (t) => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => { calls++; throw new Error("Must not contact provider"); });
  const res = await generate.POST(req());
  assert.equal(res.status, 403);
  assert.equal((await res.json()).error, "verification_required");
  assert.equal(calls, 0);
  const data = await db.db();
  assert.equal(data.generations.length, 0);
  assert.equal(data.users[0].trialUsed, false);
});

test("global test unlimited applies to administrators only", async () => {
  assert.equal(await config.isUnlimitedMode({ isAdmin: false }), false);
  assert.equal(await config.isUnlimitedMode({ isAdmin: true }), true);
  await config.setSetting("test_unlimited", "0");
  assert.equal(await config.isUnlimitedMode({ isAdmin: true }), false);
});

test("a verified ordinary account gets a trial, not unlimited generation, and an exhausted account stops before another provider request", async (t) => {
  await db.mutate(d => { d.users[0].identityVerifiedAt = 1; d.users[0].identityVerifiedBy = "email"; });
  let starts = 0;
  t.mock.method(globalThis, "fetch", async (url: string, init?: RequestInit) => {
    if (init?.method === "POST") { starts++; return Response.json({ request_id: 1 }); }
    if (url.includes("/request/get/")) return Response.json({ status: "success", result: ["https://result.example.test/image.png"] });
    return new Response(new Uint8Array(PNG));
  });
  const first = await (await generate.POST(req())).json();
  assert.equal(first.unlimited, false);
  assert.equal(first.consumed, "trial");
  assert.equal(first.generations[0].status, "done");
  const next = await generate.POST(req());
  assert.equal(next.status, 402);
  assert.equal((await next.json()).error, "no_credits");
  assert.equal(starts, 1);
  assert.equal((await db.db()).generations.length, 1);
});

test("forged reward details do not mint credits, including for a verified account", async () => {
  await db.mutate(d => { d.users[0].identityVerifiedAt = 1; d.users[0].identityVerifiedBy = "email"; });
  const request = new NextRequest("https://app.example.test/api/rewards/verify", {
    method: "POST", headers: { "Content-Type": "application/json", "x-session-token": "identity-session" },
    body: JSON.stringify({ channel: "telegram", externalId: "1234", username: "made_up" }),
  });
  const res = await rewards.POST(request);
  assert.equal(res.status, 503);
  assert.equal((await res.json()).error, "reward_verification_not_configured");
  const data = await db.db();
  assert.equal(data.users[0].credits, 0);
  assert.equal(data.rewards.length, 0);
});

test("cross-site requests cannot spend an administrator's balance", async (t) => {
  await db.mutate(d => { d.users[0].isAdmin = true; });
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => { calls++; throw new Error("Must not contact provider"); });
  const res = await generate.POST(req("https://evil.example.test"));
  assert.equal(res.status, 403);
  assert.equal((await res.json()).error, "origin_forbidden");
  assert.equal(calls, 0);
  assert.equal((await db.db()).generations.length, 0);
});
