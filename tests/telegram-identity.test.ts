import { after, before, beforeEach, test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { isolateStorage, TEST_USER } from "./helpers";

let cleanup: () => void;
let configuration: typeof import("../src/lib/telegram/config");
let identity: typeof import("../src/lib/telegram/bot-identity");
let connection: typeof import("../src/lib/telegram/connection");
let store: typeof import("../src/lib/db");
let seed: typeof import("../src/lib/config");
let route: typeof import("../src/app/api/admin/telegram/route");
const token = "123456789:FAKE_identity_check_token_1234567890";
const bypass = "0123456789abcdef0123456789abcdef";
const me = { id: 123456789, is_bot: true, username: "interier_home_bot" };

before(async () => {
  cleanup = isolateStorage();
  configuration = await import("../src/lib/telegram/config");
  identity = await import("../src/lib/telegram/bot-identity");
  connection = await import("../src/lib/telegram/connection");
  store = await import("../src/lib/db"); seed = await import("../src/lib/config");
  route = await import("../src/app/api/admin/telegram/route");
});
beforeEach(async () => {
  process.env.TELEGRAM_BOT_TOKEN = token;
  process.env.TELEGRAM_BOT_USERNAME = "interier_home_bot";
  process.env.AUTH_PUBLIC_URL = "https://identity.example.test";
  process.env.VERCEL_AUTOMATION_BYPASS_SECRET = bypass;
  await store.resetDb(); await seed.ensureSeeded();
  await store.mutate(d => {
    d.users.push({ ...TEST_USER });
    d.sessions.push({ token: "identity-admin-session", userId: TEST_USER.id, createdAt: Date.now(), expiresAt: Date.now() + 60000 });
  });
});
after(() => cleanup());

function mockMe(t: TestContext, result: unknown) {
  const calls: string[] = [];
  t.mock.method(globalThis, "fetch", async (url: string, init: RequestInit) => {
    calls.push(url);
    assert.equal(url, `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/getMe`);
    assert.equal(init.method, "POST");
    assert.equal(init.cache, "no-store");
    assert.equal(init.redirect, "error");
    return Response.json({ ok: true, result });
  });
  return calls;
}

test("read-only identity checking reports the public bot handle without installing a webhook", async t => {
  const calls = mockMe(t, { ...me, first_name: "not-required-private-metadata", token, extra: bypass });
  const cfg = configuration.telegramConfig();
  const result = await identity.inspectTelegramBot(cfg);
  assert.equal(result.matches, true);
  assert.equal(result.code, "matched");
  assert.equal(result.actualUsername, "interier_home_bot");
  assert.equal(result.botIdMatches, true);
  assert.equal(result.usernameMatches, true);
  assert.equal(calls.length, 1);
  const output = JSON.stringify(result);
  for (const secret of [token, bypass, cfg.webhookSecret, "not-required-private-metadata"]) assert.ok(!output.includes(secret));
  assert.ok(!(await store.db()).settings.some(setting => setting.key === "telegram_auth_connection"));
});

test("an actual username mismatch says which public bot Telegram returned and keeps the safety guard", async t => {
  const calls = mockMe(t, { ...me, username: "another_home_bot" });
  const result = await identity.inspectTelegramBot(configuration.telegramConfig());
  assert.equal(result.code, "username_mismatch");
  assert.equal(result.actualUsername, "another_home_bot");
  assert.equal(result.expectedUsername, "interier_home_bot");
  assert.equal(result.botIdMatches, true);
  assert.equal(result.usernameMatches, false);
  await assert.rejects(connection.connectTelegram(false), /Telegram сообщил бота @another_home_bot/);
  assert.equal(calls.length, 2, "one getMe per check, no getWebhookInfo or setWebhook");
});

test("a bot ID mismatch is distinguished from a username mismatch", async t => {
  mockMe(t, { ...me, id: 123456780 });
  const result = await identity.inspectTelegramBot(configuration.telegramConfig());
  assert.equal(result.code, "id_mismatch");
  assert.equal(result.botIdMatches, false);
  assert.equal(result.usernameMatches, true);
  assert.match(result.message, /ID не совпал/);
  await assert.rejects(connection.connectTelegram(false), /ID не совпал/);
});

test("public handles compare case-insensitively and numeric token IDs compare canonically", async t => {
  process.env.TELEGRAM_BOT_TOKEN = `000${token}`;
  process.env.TELEGRAM_BOT_USERNAME = "@Interier_Home_Bot";
  mockMe(t, me);
  const cfg = configuration.telegramConfig();
  assert.equal(cfg.botId, "123456789");
  assert.equal(cfg.token, `000${token}`, "the credential itself must not be modified");
  assert.equal((await identity.inspectTelegramBot(cfg)).matches, true);
});

test("malformed/non-bot getMe responses are unverified, not mislabeled as another bot", async t => {
  for (const result of [null, [], { ...me, is_bot: false }, { ...me, id: "123456789" }, { ...me, username: null }]) {
    const mock = t.mock.method(globalThis, "fetch", async () => Response.json({ ok: true, result }));
    const check = await identity.inspectTelegramBot(configuration.telegramConfig());
    assert.equal(check.code, "unexpected_response");
    assert.equal(check.actualUsername, null);
    assert.equal(check.botIdMatches, null);
    assert.equal(check.matches, false);
    mock.mock.restore();
  }
});

test("credential-like data is not exposed through an unexpected username field", async t => {
  mockMe(t, { ...me, username: bypass });
  const check = await identity.inspectTelegramBot(configuration.telegramConfig());
  assert.equal(check.code, "unexpected_response");
  assert.equal(check.actualUsername, null);
  assert.ok(!JSON.stringify(check).includes(bypass));
});

test("a transport or API failure is not reported as a bot mismatch and cannot echo credentials", async t => {
  t.mock.method(globalThis, "fetch", async () => { throw new Error(`socket ${token} ${bypass}`); });
  const check = await identity.inspectTelegramBot(configuration.telegramConfig());
  assert.equal(check.code, "check_failed");
  assert.equal(check.actualUsername, null);
  assert.ok(!JSON.stringify(check).includes(token));
  assert.ok(!JSON.stringify(check).includes(bypass));
});

test("only an administrator's explicit probe calls getMe; the safe API returns its public identity only", async t => {
  const calls = mockMe(t, { ...me, username: "another_home_bot" });
  const url = "https://identity.example.test/api/admin/telegram";
  assert.equal((await route.GET(new NextRequest(`${url}?probe=1`))).status, 401);
  const headers = { "x-session-token": "identity-admin-session" };
  await route.GET(new NextRequest(url, { headers }));
  assert.equal(calls.length, 0);
  const response = await route.GET(new NextRequest(`${url}?probe=1`, { headers }));
  assert.equal(response.status, 200);
  assert.match(response.headers.get("cache-control")!, /no-store/);
  const text = await response.text();
  assert.equal(JSON.parse(text).identity.actualUsername, "another_home_bot");
  assert.ok(!text.includes(token)); assert.ok(!text.includes(bypass));
  assert.equal(calls.length, 1);
  await store.mutate(d => { d.users[0].isAdmin = false; });
  assert.equal((await route.GET(new NextRequest(`${url}?probe=1`, { headers }))).status, 403);
  assert.equal(calls.length, 1);
});
