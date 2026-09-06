import { getSetting, setSetting } from "../config";
import { RequestError } from "../errors";
import { telegramConfig, telegramScopeHash, type TelegramConfig } from "./config";
import { telegramCall } from "./api";
import { inspectTelegramBot } from "./bot-identity";

const CONNECTION_KEY = "telegram_auth_connection";
export async function telegramConnected(cfg: TelegramConfig): Promise<boolean> {
  const raw = await getSetting(CONNECTION_KEY);
  if (!raw) return false;
  try { return JSON.parse(raw).fingerprint === cfg.fingerprint; } catch { return false; }
}
export async function telegramPublicStatus() {
  try {
    const cfg = telegramConfig();
    return { configured: true, username: cfg.username, publicOrigin: cfg.publicOrigin,
      bypassConfigured: !!cfg.bypass, connected: await telegramConnected(cfg) };
  } catch (e) {
    return { configured: false, username: "interier_home_bot", publicOrigin: null, bypassConfigured: false, connected: false,
      message: e instanceof RequestError ? e.message : "Telegram ещё не настроен." };
  }
}

/** Explicit admin action only. Never steal a production bot webhook on deploy/startup. */
export async function connectTelegram(takeOver: boolean) {
  const cfg = telegramConfig();
  if (!cfg.webhookUrl) throw new RequestError("telegram_public_url_missing", "Нужен постоянный AUTH_PUBLIC_URL или системный VERCEL_BRANCH_URL.", 503);
  const identity = await inspectTelegramBot(cfg);
  if (!identity.matches) {
    throw new RequestError(identity.code === "username_mismatch" || identity.code === "id_mismatch" ? "telegram_wrong_bot" : "telegram_identity_unverified", identity.message,
      identity.code === "username_mismatch" || identity.code === "id_mismatch" ? 400 : 503);
  }
  const current = await telegramCall<{ url?: string }>(cfg, "getWebhookInfo");
  if (current.url) {
    let same = false;
    try {
      const a = new URL(current.url), b = new URL(cfg.webhookUrl);
      a.searchParams.delete("x-vercel-protection-bypass"); b.searchParams.delete("x-vercel-protection-bypass");
      same = !a.username && !a.password && a.origin === b.origin && a.pathname === b.pathname && a.search === b.search;
    } catch { /* refuse replacing an unknown target without consent */ }
    if (!same && !takeOver) throw new RequestError("telegram_webhook_in_use", "У бота уже другой webhook. Подтвердите переключение только если понимаете, что предыдущая версия перестанет получать сообщения.", 409);
  }
  // Check reachability before registering a protected Preview URL with Telegram.
  try {
    const response = await fetch(cfg.webhookUrl, { cache: "no-store", redirect: "manual", signal: AbortSignal.timeout(8_000) });
    const data = response.ok ? await response.json().catch(() => null) : null;
    if (!data || data.service !== "interier-telegram-auth" || data.scope !== telegramScopeHash()) throw new Error("wrong endpoint");
  } catch {
    throw new RequestError("telegram_webhook_unreachable", "Telegram не сможет открыть адрес webhook. Для защищённого Preview создайте в Vercel Protection Bypass for Automation и выполните Redeploy. Общую защиту сайта не отключайте.", 503);
  }
  await telegramCall(cfg, "setWebhook", { url: cfg.webhookUrl, secret_token: cfg.webhookSecret,
    allowed_updates: ["message", "callback_query"], max_connections: 5, drop_pending_updates: false });
  await setSetting(CONNECTION_KEY, JSON.stringify({ fingerprint: cfg.fingerprint, username: cfg.username, origin: cfg.publicOrigin, connectedAt: Date.now() }));
  return { configured: true, connected: true, username: cfg.username, publicOrigin: cfg.publicOrigin, bypassConfigured: !!cfg.bypass };
}
