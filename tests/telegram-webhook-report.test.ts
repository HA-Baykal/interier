import { after, before, beforeEach, test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { isolateStorage, TEST_USER } from "./helpers";

let cleanup: () => void;
let store: typeof import("../src/lib/db");
let seed: typeof import("../src/lib/config");
let report: typeof import("../src/lib/telegram/webhook-report");
let setup: typeof import("../src/lib/bots/setup");
let route: typeof import("../src/app/api/admin/telegram/route");

const token = "123456789:FAKE_webhook_report_token_1234567890";
const bypass = "automation-bypass-secret-never-shown";
const PROD = "https://interier-baykal.vercel.app";
const PREVIEW = "https://interier-baykal-git-main-7a1b2c3.vercel.app";
const PATH = "/api/auth/telegram/webhook";
const headers = { "x-session-token": "webhook-admin-session", host: "interier-baykal.vercel.app" };

before(async () => {
  cleanup = isolateStorage();
  store = await import("../src/lib/db");
  seed = await import("../src/lib/config");
  report = await import("../src/lib/telegram/webhook-report");
  setup = await import("../src/lib/bots/setup");
  route = await import("../src/app/api/admin/telegram/route");
});
beforeEach(async () => {
  process.env.TELEGRAM_BOT_TOKEN = token;
  process.env.TELEGRAM_BOT_USERNAME = "interier_home_bot";
  process.env.AUTH_PUBLIC_URL = PROD;
  process.env.VERCEL_AUTOMATION_BYPASS_SECRET = bypass;
  await store.resetDb();
  await seed.ensureSeeded();
  await store.mutate((d) => {
    d.users.push({ ...TEST_USER });
    d.sessions.push({ token: "webhook-admin-session", userId: TEST_USER.id, createdAt: Date.now(), expiresAt: Date.now() + 60000 });
  });
});
after(() => cleanup());

/** Mock the Bot API; records every method+payload pair. */
function mockBotApi(t: TestContext, results: Record<string, unknown> = {}) {
  const calls: { method: string; body: any }[] = [];
  t.mock.method(globalThis, "fetch", async (url: string, init?: RequestInit) => {
    const method = String(url).split("/").at(-1)!;
    calls.push({ method, body: JSON.parse(String(init?.body || "{}")) });
    if (results[method] === undefined) return Response.json({ ok: true, result: true });
    const value = results[method];
    if (value instanceof Error) return Response.json({ ok: false, description: value.message }, { status: 400 });
    return Response.json({ ok: true, result: value });
  });
  return calls;
}

test("a webhook owned by another deployment is reported as the reason for stale answers", () => {
  const r = report.webhookReport({
    info: { url: `${PREVIEW}${PATH}`, pending_update_count: 3, allowed_updates: ["message"] },
    expectedUrl: `${PROD}${PATH}?${report.BYPASS_PARAM}=${bypass}`,
    requestOrigin: PROD,
    originSource: "AUTH_PUBLIC_URL",
  });
  assert.equal(r.code, "other_deployment");
  assert.equal(r.matches, false);
  assert.equal(r.sameDeployment, false);
  assert.equal(r.host, "interier-baykal-git-main-7a1b2c3.vercel.app");
  assert.equal(r.pendingUpdates, 3);
  assert.match(r.message, /другой адрес/);
  assert.match(r.message, /переключить бота на эту версию/);
  // The automation bypass secret never leaves the server.
  assert.ok(!r.url!.includes(bypass));
  assert.ok(!r.expectedUrl!.includes(bypass));
  assert.ok(!JSON.stringify(r).includes(bypass));
});

test("a webhook on this deployment with a bypass secret is reported as healthy", () => {
  const expected = `${PROD}${PATH}?${report.BYPASS_PARAM}=${bypass}`;
  const r = report.webhookReport({ info: { url: expected }, expectedUrl: expected, requestOrigin: PROD, originSource: "AUTH_PUBLIC_URL" });
  assert.equal(r.code, "ok");
  assert.equal(r.ok, true);
  assert.equal(r.matches, true);
  assert.equal(r.hadBypass, true);
  assert.equal(r.sameDeployment, true);
  assert.equal(r.url, `${PROD}${PATH}`);
  assert.ok(!JSON.stringify(r).includes(bypass));
});

test("an unregistered webhook is reported as silence, with the action to take", () => {
  const r = report.webhookReport({ info: { url: "" }, expectedUrl: `${PROD}${PATH}`, requestOrigin: PROD });
  assert.equal(r.code, "not_registered");
  assert.equal(r.ok, false);
  assert.match(r.message, /молчит/);
});

test("delivery errors and an unstable public address are explained", () => {
  const r = report.webhookReport({
    info: { url: `${PROD}${PATH}`, last_error_message: "Read timeout", last_error_date: 1_700_000_000, pending_update_count: 0 },
    expectedUrl: `${PROD}${PATH}`,
    requestOrigin: PROD,
    originSource: "VERCEL_BRANCH_URL",
  });
  assert.equal(r.code, "delivery_errors");
  assert.equal(r.lastError, "Read timeout");
  assert.equal(r.lastErrorAt, 1_700_000_000_000);
  assert.match(r.message, /Read timeout/);
  assert.match(r.message, /AUTH_PUBLIC_URL/);
});

test("a failed probe is a result, not a crash, and cannot leak the token", async (t) => {
  t.mock.method(globalThis, "fetch", async () => { throw new Error(`socket error ${token}`); });
  const r = await report.fetchTelegramWebhookReport({ token, expectedUrl: `${PROD}${PATH}`, requestOrigin: PROD });
  assert.equal(r.code, "check_failed");
  assert.equal(r.ok, false);
  assert.ok(!JSON.stringify(r).includes(token));
});

test("the admin probe reads webhook_info and reports the application switches", async (t) => {
  const calls = mockBotApi(t, {
    getMe: { id: 123456789, is_bot: true, username: "interier_home_bot" },
    getWebhookInfo: { url: `${PREVIEW}${PATH}`, pending_update_count: 1 },
  });
  const res = await route.GET(new NextRequest(`${PROD}/api/admin/telegram?probe=1`, { headers }));
  assert.equal(res.status, 200);
  const text = await res.text();
  const body = JSON.parse(text);
  assert.equal(body.webhook.code, "other_deployment");
  assert.equal(body.webhook.host, "interier-baykal-git-main-7a1b2c3.vercel.app");
  assert.equal(body.app.appEnabled, true);
  assert.equal(body.app.simulator, false);
  assert.equal(body.app.tokenSource, "env");
  assert.ok(calls.some((c) => c.method === "getWebhookInfo"));
  assert.ok(!text.includes(token));
  assert.ok(!text.includes(bypass));
});

test("a left-open simulator is visible in the diagnostics", async (t) => {
  mockBotApi(t, { getMe: { id: 123456789, is_bot: true, username: "interier_home_bot" } });
  await seed.setSetting("bots_simulator", "1");
  const body = await (await route.GET(new NextRequest(`${PROD}/api/admin/telegram?probe=1`, { headers }))).json();
  assert.equal(body.app.simulator, true);
});

test("the bot profile is pushed to Telegram without touching the webhook", async (t) => {
  const calls = mockBotApi(t, { getMe: { id: 123456789, is_bot: true, username: "interier_home_bot" } });
  await seed.setSetting("telegram_name", "Interier — дизайн интерьера");
  const res = await route.POST(new NextRequest(`${PROD}/api/admin/telegram`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ profile: true }),
  }));
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(body.profile.ok, true);
  assert.equal(body.profile.name, "Interier — дизайн интерьера");

  const methods = calls.map((c) => c.method);
  assert.ok(methods.includes("setMyName"), "setMyName must be called");
  assert.ok(methods.filter((m) => m === "setMyDescription").length >= 2, "description in RU and EN");
  assert.ok(methods.filter((m) => m === "setMyShortDescription").length >= 2, "short description in RU and EN");
  assert.ok(methods.includes("setMyCommands"), "the command list must be registered");
  assert.ok(methods.includes("setChatMenuButton"), "the Mini App menu button must be set");
  assert.ok(!methods.includes("setWebhook"), "the profile action must not rewrite the webhook");

  const name = calls.find((c) => c.method === "setMyName")!;
  assert.equal(name.body.name, "Interier — дизайн интерьера");
  const menu = calls.find((c) => c.method === "setChatMenuButton")!;
  assert.equal(menu.body.menu_button.type, "web_app");
  assert.equal(menu.body.menu_button.web_view_url, `${PROD}/app`);
  // The «About» text must present the bot as the app, not as a login helper.
  const description = calls.find((c) => c.method === "setMyDescription")!;
  assert.match(description.body.description, /приложени/i);
  assert.ok(description.body.description.length <= 512);
  const short = calls.find((c) => c.method === "setMyShortDescription")!;
  assert.ok(short.body.short_description.length <= 120);
  assert.ok(Number((await store.db()).settings.find((s) => s.key === "telegram_profile_applied")?.value) > 0);
});

test("the webhook expectation follows AUTH_PUBLIC_URL and the login transport path", async () => {
  const { expectedUrl, originSource } = await setup.telegramWebhookExpectation("interier-baykal.vercel.app");
  assert.equal(expectedUrl, `${PROD}${PATH}?${report.BYPASS_PARAM}=${bypass}`);
  assert.equal(originSource, "AUTH_PUBLIC_URL");
});
