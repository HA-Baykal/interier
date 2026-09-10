/**
 * One-command Telegram bot setup.
 *
 * Registers webhooks (Telegram `setWebhook`), the Telegram Mini App menu button
 * and the command list.
 */

import { randomBytes } from "crypto";
import { getSettingOrEnv, setSetting } from "../config";
import { RequestError } from "../errors";
import { BotPlatform } from "../types";
import { appUrl, platformsStatus, publicBaseUrl, telegramConfig } from "./config";

export function webhookPath(platform: BotPlatform = "telegram"): string {
  return "/api/auth/telegram/webhook";
}

async function ensureWebhookSecret(key: string): Promise<string> {
  const current = await getSettingOrEnv(key);
  if (current) return current;
  const fresh = randomBytes(24).toString("hex");
  await setSetting(key, fresh);
  return fresh;
}

export type SetupResult = { ok: boolean; url?: string; error?: string; detail?: string };

export async function setupTelegram(hostHint?: string | null): Promise<SetupResult> {
  const cfg = await telegramConfig();
  if (!cfg.token) return { ok: false, error: "TELEGRAM_BOT_TOKEN не задан (админка → Боты или env)" };
  await ensureWebhookSecret("telegram_webhook_secret");

  const { connectTelegram } = await import("@/lib/telegram/connection");
  let url: string | undefined;
  try {
    const conn = await connectTelegram(false);
    url = conn.publicOrigin ? `${conn.publicOrigin}${webhookPath("telegram")}` : undefined;
  } catch (e) {
    const code = e instanceof RequestError ? e.code : "";
    const message =
      code === "telegram_webhook_in_use"
        ? "У бота уже другой webhook. Подтвердите переключение в блоке «Telegram» на странице /admin."
        : e instanceof Error
        ? e.message
        : "Telegram connect failed";
    return { ok: false, error: message, url };
  }
  const { tgMe } = await import("./telegram");

  const app = await appUrl(hostHint);
  try {
    const { call } = await import("./telegramApi");
    await call(cfg.token, "setChatMenuButton", { menu_button: { type: "web_app", text: "Открыть Interier", web_view_url: app } });
    await call(cfg.token, "setMyDescription", { description: "Дизайн интерьера по фото + где купить каждую деталь. Работает как приложение." });
    await call(cfg.token, "setMyShortDescription", { short_description: "Дизайн комнаты по фото и ссылки на детали" });
  } catch {
    /* menu button is optional */
  }
  if (!cfg.miniAppUrl) await setSetting("telegram_mini_app_url", app);
  if (!cfg.botUsername) {
    const me = await tgMe();
    if (me?.username) await setSetting("telegram_bot_username", me.username);
  }
  return { ok: true, url, detail: `@${(await telegramConfig()).botUsername || "?"}` };
}

export async function setupPlatform(platform: BotPlatform = "telegram", hostHint?: string | null): Promise<SetupResult> {
  return setupTelegram(hostHint);
}

export async function syncAllWebhooks(hostHint?: string | null): Promise<Record<string, SetupResult>> {
  const out: Record<string, SetupResult> = {};
  const cfg = await getSettingOrEnv("telegram_bot_token");
  if (!cfg) {
    out.telegram = { ok: false, error: "не настроен" };
  } else {
    try {
      out.telegram = await setupTelegram(hostHint);
    } catch (e) {
      out.telegram = { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }
  return out;
}

/** Status snapshot for the admin panel. */
export async function botsStatus(hostHint?: string | null) {
  const [status, base, app, tgWebhook, tgMe] = await Promise.all([
    platformsStatus(),
    publicBaseUrl(hostHint),
    appUrl(hostHint),
    import("./telegram").then((m) => m.tgWebhookInfo()),
    import("./telegram").then((m) => m.tgMe()),
  ]);

  return {
    baseUrl: base,
    appUrl: app,
    webhookPaths: { telegram: webhookPath("telegram") },
    platforms: status.map((s) => ({
      ...s,
      me: tgMe,
      webhook: tgWebhook?.url || null,
      error: tgWebhook?.lastError || null,
    })),
  };
}
