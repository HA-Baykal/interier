/**
 * One-command bot setup.
 *
 * Registers webhooks (Telegram `setWebhook`, MAX `POST /subscriptions`, VK
 * Callback API), the Telegram Mini App menu button and the command list, so the
 * owner only has to paste tokens in the admin panel and press "Подключить".
 */

import { randomBytes } from "crypto";
import { getSettingOrEnv, setSetting } from "../config";
import { BotPlatform } from "../types";
import { appUrl, maxConfig, platformsStatus, publicBaseUrl, telegramConfig, vkConfig } from "./config";

export function webhookPath(platform: BotPlatform): string {
  return `/api/bots/${platform}/webhook`;
}

/**
 * Webhooks must not be open endpoints: anyone who knows the URL could speak to
 * the bot as any user. Both Telegram (`secret_token`) and MAX (`secret`) echo a
 * shared secret, so we mint one the first time the owner presses "Подключить".
 */
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
  const base = await publicBaseUrl(hostHint);
  const url = `${base}${webhookPath("telegram")}`;

  await ensureWebhookSecret("telegram_webhook_secret");
  const { tgSetWebhook, tgMe } = await import("./telegram");
  const res = await tgSetWebhook(url);
  if (!res.ok) return { ok: false, error: res.error, url };

  // The bot's menu button opens our mini app — this is what makes it "an app".
  const app = await appUrl(hostHint);
  try {
    const { call } = await import("./telegramApi");
    await call(cfg.token, "setChatMenuButton", { menu_button: { type: "web_app", text: "Открыть Interier", web_view_url: app } });
    await call(cfg.token, "setMyDescription", { description: "Дизайн интерьера по фото + где купить каждую деталь. Работает как приложение." });
    await call(cfg.token, "setMyShortDescription", { short_description: "Дизайн комнаты по фото и ссылки на детали" });
  } catch {
    /* menu button is optional (older Bot API servers ignore unknown methods) */
  }
  if (!cfg.miniAppUrl) await setSetting("telegram_mini_app_url", app);
  if (!cfg.botUsername) {
    const me = await tgMe();
    if (me?.username) await setSetting("telegram_bot_username", me.username);
  }
  return { ok: true, url, detail: `@${(await telegramConfig()).botUsername || "?"}` };
}

export async function setupVk(hostHint?: string | null): Promise<SetupResult> {
  const cfg = await vkConfig();
  if (!cfg.token) return { ok: false, error: "VK_ACCESS_TOKEN не задан" };
  const base = await publicBaseUrl(hostHint);
  const url = `${base}${webhookPath("vk")}`;
  const { vkSetCallbackServer } = await import("./vk");
  const r = await vkSetCallbackServer(url);
  if (!r.ok) return { ok: false, error: r.error, url };
  return { ok: true, url, detail: r.serverId ? `server ${r.serverId}` : undefined };
}

export async function setupMax(hostHint?: string | null): Promise<SetupResult> {
  const cfg = await maxConfig();
  if (!cfg.token) return { ok: false, error: "MAX_BOT_TOKEN не задан" };
  const base = await publicBaseUrl(hostHint);
  if (!/^https:\/\//.test(base)) {
    return { ok: false, error: "MAX принимает только HTTPS-вебхук: задайте PUBLIC_BASE_URL (https://…)", url: base };
  }
  const url = `${base}${webhookPath("max")}`;
  await ensureWebhookSecret("max_webhook_secret");
  const r = await import("./max").then((m) => m.maxSetSubscription(url));
  if (!r.ok) return { ok: false, error: r.error, url };
  return { ok: true, url };
}

export async function setupPlatform(platform: BotPlatform, hostHint?: string | null): Promise<SetupResult> {
  if (platform === "telegram") return setupTelegram(hostHint);
  if (platform === "vk") return setupVk(hostHint);
  return setupMax(hostHint);
}

export async function syncAllWebhooks(hostHint?: string | null): Promise<Record<string, SetupResult>> {
  const out: Record<string, SetupResult> = {};
  for (const p of ["telegram", "vk", "max"] as BotPlatform[]) {
    const cfg = await getSettingOrEnv(`${p === "telegram" ? "telegram_bot_token" : p === "vk" ? "vk_access_token" : "max_bot_token"}`);
    if (!cfg) {
      out[p] = { ok: false, error: "не настроен" };
      continue;
    }
    try {
      out[p] = await setupPlatform(p, hostHint);
    } catch (e) {
      out[p] = { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }
  return out;
}

/** Status snapshot for the admin panel (config + live checks). */
export async function botsStatus(hostHint?: string | null) {
  const [status, base, app, tgWebhook, maxSub] = await Promise.all([
    platformsStatus(),
    publicBaseUrl(hostHint),
    appUrl(hostHint),
    import("./telegram").then((m) => m.tgWebhookInfo()),
    import("./max").then((m) => m.maxGetSubscriptions()),
  ]);
  const [tgMe, vkMe, maxMe] = await Promise.all([
    import("./telegram").then((m) => m.tgMe()),
    import("./vk").then((m) => m.vkMe()),
    import("./max").then((m) => m.maxMe()),
  ]);

  return {
    baseUrl: base,
    appUrl: app,
    webhookPaths: { telegram: webhookPath("telegram"), vk: webhookPath("vk"), max: webhookPath("max") },
    platforms: status.map((s) => ({
      ...s,
      me: s.platform === "telegram" ? tgMe : s.platform === "vk" ? vkMe : maxMe,
      webhook:
        s.platform === "telegram"
          ? tgWebhook?.url || null
          : s.platform === "max"
          ? maxSub.url || null
          : null,
      error:
        s.platform === "telegram"
          ? tgWebhook?.lastError || null
          : s.platform === "max"
          ? maxSub.error || null
          : null,
    })),
  };
}
