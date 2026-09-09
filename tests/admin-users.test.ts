import { after, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { isolateStorage, TEST_USER } from "./helpers";
import { User } from "../src/lib/types";

let cleanup: () => void;
let store: typeof import("../src/lib/db");
let seed: typeof import("../src/lib/config");
let route: typeof import("../src/app/api/admin/users/route");
let support: typeof import("../src/lib/bots/support");

function botUser(overrides: Partial<User> = {}): User {
  return {
    id: "usr_bot_alice",
    email: null,
    passwordHash: "unused",
    name: "Alice",
    createdAt: 10,
    credits: 2,
    trialUsed: true,
    telegramId: 1,
    telegramUsername: "alice_design",
    vkId: null,
    vkUsername: null,
    maxId: null,
    maxUsername: null,
    origin: "telegram",
    prefLocale: "ru",
    referralCode: "ALICE123",
    referredBy: null,
    isAdmin: false,
    verifiedIdentities: [{ provider: "telegram" as const, subject: "1", verifiedAt: 10 }],
    identityVerifiedAt: 10,
    identityVerifiedBy: "telegram" as const,
    ...overrides,
  };
}

before(async () => {
  cleanup = isolateStorage();
  store = await import("../src/lib/db");
  seed = await import("../src/lib/config");
  route = await import("../src/app/api/admin/users/route");
  support = await import("../src/lib/bots/support");
});

beforeEach(async () => {
  await store.resetDb();
  await seed.ensureSeeded();
  await store.mutate((d) => {
    d.users.push({ ...TEST_USER });
    d.users.push(botUser());
    d.users.push(botUser({ id: "usr_bot_alice2", telegramId: 2, telegramUsername: "alice2_style", referralCode: "ALICE200" }));
    // A pure web account must not count as a bot user.
    d.users.push(
      botUser({
        id: "usr_web_only",
        telegramId: null,
        telegramUsername: null,
        vkId: null,
        vkUsername: null,
        maxId: null,
        maxUsername: null,
        origin: "web",
        verifiedIdentities: [],
        identityVerifiedAt: null,
        identityVerifiedBy: null,
        referralCode: "WEB0001",
      })
    );
    d.sessions.push({ token: "admin-session", userId: TEST_USER.id, createdAt: Date.now(), expiresAt: Date.now() + 60000 });
  });
});

after(() => cleanup());

function getReq(q?: string, bot?: boolean) {
  const params = new URLSearchParams();
  if (q) params.set("q", q);
  if (bot) params.set("bot", "1");
  return new NextRequest(`https://app.example.test/api/admin/users${params.toString() ? `?${params}` : ""}`, {
    headers: { "x-session-token": "admin-session" },
  });
}

function postReq(body: unknown) {
  return new NextRequest("https://app.example.test/api/admin/users", {
    method: "POST",
    headers: { "x-session-token": "admin-session", origin: "https://app.example.test", "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

test("GET lists bot users with balance, designs and handles", async () => {
  const res = await route.GET(getReq(undefined, true));
  const body = await res.json();
  assert.equal(res.status, 200);
  const ids = body.users.map((u: { id: string }) => u.id);
  assert.ok(ids.includes("usr_bot_alice"));
  assert.ok(ids.includes("usr_bot_alice2"));
  assert.ok(!ids.includes("usr_web_only"));
  const alice = body.users.find((u: { id: string }) => u.id === "usr_bot_alice");
  assert.equal(alice.nickname, "@alice_design");
  assert.equal(alice.credits, 2);
  assert.equal(alice.platforms[0], "telegram");
});

test("GET searches by nickname without @", async () => {
  const res = await route.GET(getReq("@alice2", true));
  const body = await res.json();
  assert.equal(body.users.length, 1);
  assert.equal(body.users[0].id, "usr_bot_alice2");
});

test("POST grants credits by userId", async () => {
  const res = await route.POST(postReq({ userId: "usr_bot_alice", amount: 7 }));
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.granted, 7);
  assert.equal(body.credits, 9);
  const u = (await store.db()).users.find((x) => x.id === "usr_bot_alice");
  assert.equal(u?.credits, 9);
});

test("POST grants credits by unique nickname (with @ prefix)", async () => {
  const res = await route.POST(postReq({ query: "@alice_design", amount: 3 }));
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.credits, 5);
});

test("POST returns multiple candidates and does not change balances", async () => {
  const res = await route.POST(postReq({ query: "alice", amount: 1 }));
  const body = await res.json();
  assert.equal(res.status, 409);
  assert.equal(body.error, "multiple");
  assert.ok((body.users || []).length >= 2);
  const alice = (await store.db()).users.find((x) => x.id === "usr_bot_alice");
  assert.equal(alice?.credits, 2);
});

test("POST rejects unknown user, bad amount and unauthenticated requests", async () => {
  const notFound = await route.POST(postReq({ query: "nobody_here", amount: 1 }));
  assert.equal(notFound.status, 404);
  assert.equal((await notFound.json()).error, "not_found");

  const bad = await route.POST(postReq({ userId: "usr_bot_alice", amount: 0 }));
  assert.equal(bad.status, 400);
  assert.equal((await bad.json()).error, "bad_amount");

  const unauth = new NextRequest("https://app.example.test/api/admin/users", {
    method: "POST",
    headers: { origin: "https://app.example.test", "content-type": "application/json" },
    body: JSON.stringify({ userId: "usr_bot_alice", amount: 1 }),
  });
  assert.equal((await route.POST(unauth)).status, 403);
});

test("support message points to the configured clickable @username", async () => {
  const out = await support.creditSupportMessage("ru", "no_credits");
  assert.ok(out.text!.includes("@vektor_komforta38"));
  const btn = out.buttons![0][0];
  assert.equal(btn.kind, "link");
  assert.equal(btn.text, "💬 Поддержка: @vektor_komforta38");
  assert.equal(btn.url, "https://t.me/vektor_komforta38");
});
