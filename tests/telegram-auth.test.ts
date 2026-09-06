import { after, before, beforeEach, test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { isolateStorage, TEST_USER } from "./helpers";

let cleanup: () => void;
let store: typeof import("../src/lib/db");
let seed: typeof import("../src/lib/config");
let connection: typeof import("../src/lib/telegram/connection");
let login: typeof import("../src/lib/telegram/login");
let configuration: typeof import("../src/lib/telegram/config");
let security: typeof import("../src/lib/security-store");
let webhook: typeof import("../src/app/api/auth/telegram/webhook/route");
let auth: typeof import("../src/lib/auth");
const TOKEN = "123456789:FAKE_telegram_token_for_tests_123456789";
const BYPASS = "fake-automation-secret-do-not-display";
const person = { id: 987654321, is_bot: false, first_name: "Тест", last_name: "Пользователь", username: "fixture_user" };

before(async () => {
  cleanup = isolateStorage();
  store = await import("../src/lib/db"); seed = await import("../src/lib/config");
  configuration = await import("../src/lib/telegram/config"); connection = await import("../src/lib/telegram/connection");
  login = await import("../src/lib/telegram/login"); security = await import("../src/lib/security-store");
  webhook = await import("../src/app/api/auth/telegram/webhook/route"); auth = await import("../src/lib/auth");
});
beforeEach(async () => {
  process.env.TELEGRAM_BOT_TOKEN = TOKEN; process.env.TELEGRAM_BOT_USERNAME = "interier_home_bot";
  process.env.AUTH_PUBLIC_URL = "https://auth.example.test"; process.env.VERCEL_AUTOMATION_BYPASS_SECRET = BYPASS;
  security.resetSecurityMemoryForTests(); await store.resetDb(); await seed.ensureSeeded();
  await store.mutate(d => { d.users.push({ ...TEST_USER }); });
});
after(() => cleanup());

function wire(t: TestContext, options: { initialUrl?: string; inaccessible?: boolean; wrongBot?: boolean } = {}) {
  let url = options.initialUrl || "";
  const calls: { method: string; body: any }[] = [];
  t.mock.method(globalThis, "fetch", async (target: string, init?: RequestInit) => {
    if (target.startsWith("https://auth.example.test/")) {
      assert.equal(new URL(target).searchParams.get("x-vercel-protection-bypass"), BYPASS);
      return options.inaccessible ? new Response("Protected", { status: 302, headers: { Location: "https://vercel.com/login" } })
        : Response.json({ service: "interier-telegram-auth", scope: configuration.telegramScopeHash() });
    }
    assert.ok(target.startsWith(`https://api.telegram.org/bot${TOKEN}/`), "Only the Telegram API may receive its token");
    assert.equal(init?.method, "POST"); assert.equal(init?.redirect, "error"); assert.ok(init?.signal);
    const method = target.split("/").at(-1)!;
    const body = JSON.parse(String(init?.body)); calls.push({ method, body });
    const results: Record<string, unknown> = {
      getMe: { id: 123456789, username: options.wrongBot ? "wrong_bot" : "interier_home_bot", is_bot: true },
      getWebhookInfo: { url }, sendMessage: { message_id: 123 }, answerCallbackQuery: true, setWebhook: true,
    };
    if (method === "setWebhook") { url = body.url; assert.equal(body.drop_pending_updates, false); assert.equal(body.secret_token, configuration.telegramConfig().webhookSecret); }
    return Response.json({ ok: true, result: results[method] });
  });
  return { calls, move: (next: string) => { url = next; } };
}
async function connected(t: TestContext) { const fixture = wire(t); await connection.connectTelegram(false); return fixture; }
function startUpdate(id: string, user = person) { return { update_id: 1, message: { text: `/start auth_${id}`, from: user, chat: { id: user.id, type: "private" } } }; }
function approveUpdate(id: string, user = person, action = "approve") {
  return { update_id: 2, callback_query: { id: "callback-fixture", from: user, data: `auth:${action}:${id}`, message: { from: { id: 123456789, is_bot: true }, chat: { id: user.id, type: "private" } } } };
}
async function deliver(update: unknown, secret = configuration.telegramConfig().webhookSecret) {
  return webhook.POST(new NextRequest("https://auth.example.test/api/auth/telegram/webhook", { method: "POST", headers: { "Content-Type": "application/json", "x-telegram-bot-api-secret-token": secret }, body: JSON.stringify(update) }));
}
async function confirm(id: string) { assert.equal((await deliver(startUpdate(id))).status, 200); assert.equal((await deliver(approveUpdate(id))).status, 200); }

test("connection is explicit, checks the bot and public endpoint, and does not disclose either secret", async t => {
  const fixture = wire(t);
  assert.equal((await connection.telegramPublicStatus()).connected, false);
  assert.equal(fixture.calls.length, 0, "rendering status does not install a webhook");
  const status = await connection.connectTelegram(false);
  assert.equal(status.connected, true);
  assert.equal(status.username, "interier_home_bot");
  const serialized = JSON.stringify(status);
  for (const secret of [TOKEN, BYPASS, configuration.telegramConfig().webhookSecret]) assert.ok(!serialized.includes(secret));
  const installed = fixture.calls.find(call => call.method === "setWebhook")!;
  assert.deepEqual(installed.body.allowed_updates, ["message", "callback_query"]);
  assert.equal(installed.body.drop_pending_updates, false);
  assert.ok(!JSON.stringify((await store.db()).settings).includes(TOKEN));
  assert.ok(!JSON.stringify((await store.db()).settings).includes(BYPASS));
});

test("a protected/unreachable Preview cannot be silently registered as a working webhook", async t => {
  const fixture = wire(t, { inaccessible: true });
  await assert.rejects(connection.connectTelegram(false), /Protection Bypass/);
  assert.ok(!fixture.calls.some(call => call.method === "setWebhook"));
  assert.equal((await connection.telegramPublicStatus()).connected, false);
});

test("a different bot or an existing foreign webhook cannot be replaced accidentally", async t => {
  const fixture = wire(t, { initialUrl: "https://another.example.test/private?secret=private" });
  await assert.rejects(connection.connectTelegram(false), /другой webhook/);
  assert.ok(!fixture.calls.some(call => call.method === "setWebhook"));
  await connection.connectTelegram(true);
  assert.equal(fixture.calls.filter(call => call.method === "setWebhook").length, 1);
});

test("a token for a different username is rejected before changing Telegram settings", async t => {
  const fixture = wire(t, { wrongBot: true });
  await assert.rejects(connection.connectTelegram(false), /Telegram сообщил бота @wrong_bot/);
  assert.ok(!fixture.calls.some(call => call.method === "setWebhook"));
});

test("the full login requires bot approval AND this browser's polling secret; repeat delivery does not duplicate an account/session", async t => {
  const fixture = await connected(t);
  const challenge = await login.startTelegramLogin({ purpose: "login", clientBucket: "test-ip" });
  assert.ok(challenge.botUrl.includes(`auth_${challenge.id}`));
  assert.ok(!challenge.botUrl.includes(challenge.secret));
  assert.equal((await login.pollTelegramLogin(challenge)).status, "pending");
  assert.equal((await store.db()).users.length, 1);
  assert.equal((await deliver(approveUpdate(challenge.id), "forged-secret")).status, 401);
  await confirm(challenge.id);
  await assert.rejects(login.pollTelegramLogin({ id: challenge.id, secret: "0".repeat(64) }), /недействителен/);
  const result = await login.pollTelegramLogin(challenge);
  assert.equal(result.status, "authenticated");
  if (result.status !== "authenticated") throw new Error("Expected authentication");
  const user = await auth.getUserByToken(result.token);
  assert.ok(user); assert.equal(user.isAdmin, false); assert.equal(user.email, null); assert.equal(user.credits, 0); assert.equal(user.trialUsed, false);
  assert.equal(user.identityVerifiedBy, "telegram");
  assert.deepEqual(user.verifiedIdentities?.map(identity => [identity.provider, identity.subject]), [["telegram", String(person.id)]]);
  assert.equal(auth.verifyPassword("anything", user.passwordHash), false);
  await deliver(approveUpdate(challenge.id));
  const repeated = await login.pollTelegramLogin(challenge);
  assert.deepEqual(repeated, result);
  await assert.rejects(login.pollTelegramLogin({ ...challenge, cancel: true }), /завершается или завершён/);
  assert.equal((await store.db()).users.length, 2);
  assert.equal((await store.db()).sessions.filter(session => session.userId === user.id).length, 1);
  const message = fixture.calls.find(call => call.method === "sendMessage")!.body;
  assert.ok(message.text.includes(challenge.code));
  assert.ok(message.text.includes("ВЫ САМИ"));
  assert.ok(!JSON.stringify(message).includes(challenge.secret));
  assert.ok(!fixture.calls.some(call => call.method.includes("generate")));
  await auth.destroySession(result.token);
  await assert.rejects(login.pollTelegramLogin(challenge), /Сессия завершена/);
});

test("a callback from another Telegram account or a group does not approve the login", async t => {
  await connected(t);
  const challenge = await login.startTelegramLogin({ purpose: "login", clientBucket: "test-ip" });
  await deliver(startUpdate(challenge.id));
  await deliver(approveUpdate(challenge.id, { ...person, id: 999999999 }));
  assert.equal((await login.pollTelegramLogin(challenge)).status, "pending");
  const group = approveUpdate(challenge.id); group.callback_query.message.chat.type = "group";
  await deliver(group);
  assert.equal((await login.pollTelegramLogin(challenge)).status, "pending");
  assert.equal((await store.db()).users.length, 1);
});

test("legacy Telegram IDs do not log someone into an existing administrator account", async t => {
  await connected(t);
  await store.mutate(d => { d.users[0].telegramId = person.id; });
  const challenge = await login.startTelegramLogin({ purpose: "login", clientBucket: "test-ip" });
  await confirm(challenge.id);
  const result = await login.pollTelegramLogin(challenge);
  assert.equal(result.status, "authenticated");
  if (result.status !== "authenticated") throw new Error("Expected authentication");
  const user = await auth.getUserByToken(result.token);
  assert.notEqual(user?.id, TEST_USER.id); assert.equal(user?.isAdmin, false);
});

test("explicit linking preserves the administrator's ID, balance and history; later Telegram login returns that account", async t => {
  await connected(t);
  const owner = (await store.db()).users[0];
  const challenge = await login.startTelegramLogin({ purpose: "link", owner, clientBucket: "test-ip" });
  await confirm(challenge.id);
  await assert.rejects(login.pollTelegramLogin(challenge), /аккаунт/);
  assert.equal((await login.pollTelegramLogin({ ...challenge, owner })).status, "linked");
  assert.equal((await store.db()).users.length, 1);
  assert.equal((await store.db()).users[0].credits, TEST_USER.credits);
  const next = await login.startTelegramLogin({ purpose: "login", clientBucket: "test-ip" });
  await confirm(next.id);
  const result = await login.pollTelegramLogin(next);
  if (result.status !== "authenticated") throw new Error("Expected authentication");
  assert.equal((await auth.getUserByToken(result.token))?.id, TEST_USER.id);
  assert.equal((await auth.getUserByToken(result.token))?.isAdmin, true);
});

test("link conflicts do not merge balances or promote an existing social account", async t => {
  await connected(t);
  const first = await login.startTelegramLogin({ purpose: "login", clientBucket: "test-ip" }); await confirm(first.id);
  await login.pollTelegramLogin(first);
  const owner = (await store.db()).users[0];
  const link = await login.startTelegramLogin({ purpose: "link", owner, clientBucket: "test-ip" }); await confirm(link.id);
  await assert.rejects(login.pollTelegramLogin({ ...link, owner }), /другим аккаунтом/);
  const users = (await store.db()).users;
  assert.equal(users.length, 2); assert.equal(users[0].credits, TEST_USER.credits); assert.equal(users[1].isAdmin, false);
});

test("subsequent sign-ins preserve the canonical user and cannot reset a used trial or mint credits", async t => {
  await connected(t);
  const first = await login.startTelegramLogin({ purpose: "login", clientBucket: "test-ip" }); await confirm(first.id);
  const a = await login.pollTelegramLogin(first); if (a.status !== "authenticated") throw new Error("Expected auth");
  const id = (await auth.getUserByToken(a.token))!.id;
  await store.mutate(d => { const user = d.users.find(u => u.id === id)!; user.trialUsed = true; user.credits = 7; });
  const second = await login.startTelegramLogin({ purpose: "login", clientBucket: "test-ip" }); await confirm(second.id);
  const b = await login.pollTelegramLogin(second); if (b.status !== "authenticated") throw new Error("Expected auth");
  const user = await auth.getUserByToken(b.token);
  assert.equal(user?.id, id); assert.equal(user?.trialUsed, true); assert.equal(user?.credits, 7);
});

test("cancelled or expired challenges never create a verified account", async t => {
  await connected(t);
  const challenge = await login.startTelegramLogin({ purpose: "login", clientBucket: "test-ip" });
  assert.equal((await login.pollTelegramLogin({ ...challenge, cancel: true })).status, "denied");
  await confirm(challenge.id);
  assert.equal((await login.pollTelegramLogin(challenge)).status, "denied");
  const next = await login.startTelegramLogin({ purpose: "login", clientBucket: "test-ip" });
  const future = next.expiresAt + 1;
  t.mock.method(Date, "now", () => future);
  await assert.rejects(login.pollTelegramLogin(next), /истёк/);
  assert.equal((await store.db()).users.length, 1);
});

test("rate limits and a moved webhook stop new login requests instead of silently hanging", async t => {
  const fixture = await connected(t);
  for (let i = 0; i < 10; i++) await login.startTelegramLogin({ purpose: "login", clientBucket: "same-ip" });
  await assert.rejects(login.startTelegramLogin({ purpose: "login", clientBucket: "same-ip" }), /Слишком много/);
  fixture.move("https://production.example.test/another-webhook");
  await assert.rejects(login.startTelegramLogin({ purpose: "login", clientBucket: "other-ip" }), /Webhook бота изменился/);
});

test("concurrent browser polls and simultaneous logins for one Telegram cannot duplicate an account or a trial", async t => {
  await connected(t);
  const first = await login.startTelegramLogin({ purpose: "login", clientBucket: "ip-a" });
  const second = await login.startTelegramLogin({ purpose: "login", clientBucket: "ip-b" });
  await confirm(first.id); await confirm(second.id);
  const replies = await Promise.all([login.pollTelegramLogin(first), login.pollTelegramLogin(first), login.pollTelegramLogin(second)]);
  assert.ok(replies.some(reply => reply.status === "authenticated"));
  const a = await login.pollTelegramLogin(first), b = await login.pollTelegramLogin(second);
  if (a.status !== "authenticated" || b.status !== "authenticated") throw new Error("Expected authentication");
  assert.equal((await auth.getUserByToken(a.token))?.id, (await auth.getUserByToken(b.token))?.id);
  assert.equal((await store.db()).users.length, 2);
  assert.equal((await store.db()).sessions.length, 2, "one session per browser challenge, not per poll");
});

test("HTTP admin setup is authenticated, same-origin, and never discloses configured secrets", async t => {
  const fixture = wire(t);
  const adminRoute = await import("../src/app/api/admin/telegram/route");
  const publicRoute = await import("../src/app/api/auth/providers/route");
  const anonymous = new NextRequest("https://auth.example.test/api/admin/telegram");
  assert.equal((await adminRoute.GET(anonymous)).status, 401);
  await store.mutate(d => { d.sessions.push({ token: "setup-session", userId: TEST_USER.id, createdAt: Date.now(), expiresAt: Date.now() + 60000 }); });
  const status = await adminRoute.GET(new NextRequest(anonymous.url, { headers: { "x-session-token": "setup-session" } }));
  const text = await status.text();
  assert.equal(status.status, 200);
  for (const secret of [TOKEN, BYPASS, configuration.telegramConfig().webhookSecret]) assert.ok(!text.includes(secret));
  assert.equal((await (await publicRoute.GET()).json()).telegram.available, false);
  const hostile = new NextRequest(anonymous.url, { method: "POST", headers: { "x-session-token": "setup-session", Origin: "https://evil.example.test", "Content-Type": "application/json" }, body: JSON.stringify({ takeOver: true }) });
  assert.equal((await adminRoute.POST(hostile)).status, 403);
  assert.equal(fixture.calls.length, 0);
});

test("HTTP polling sets the normal secure session cookie only after real server-side approval", async t => {
  await connected(t);
  const pollRoute = await import("../src/app/api/auth/telegram/poll/route");
  const challenge = await login.startTelegramLogin({ purpose: "login", clientBucket: "test-ip" });
  const request = () => new NextRequest("https://auth.example.test/api/auth/telegram/poll", { method: "POST", headers: { "Content-Type": "application/json", Origin: "https://auth.example.test" }, body: JSON.stringify({ id: challenge.id, secret: challenge.secret }) });
  const pending = await pollRoute.POST(request());
  assert.equal(pending.headers.get("set-cookie"), null);
  await confirm(challenge.id);
  const response = await pollRoute.POST(request());
  const data = await response.json();
  assert.equal(data.status, "authenticated");
  const cookie = response.headers.get("set-cookie")!;
  for (const pattern of [/^interier_session=/, /; HttpOnly/i, /; Secure/i, /; SameSite=none/i]) assert.match(cookie, pattern);
  assert.equal((await auth.getUserByToken(data.token))?.identityVerifiedBy, "telegram");
});
