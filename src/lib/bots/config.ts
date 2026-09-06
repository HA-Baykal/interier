/**
 * Messenger configuration (Telegram / VK / MAX).
 *
 * Every value can live either in the environment (hosting panel) or in the
 * admin panel (DB setting wins), because tokens are usually pasted into the
 * panel once and then tuned from the UI while testing.
 */

import { getSetting, getSettingBool, getSettingOrEnv } from "../config";
import { cleanConnectionValue } from "../env";
import { BotPlatform } from "../types";

export type TelegramConfig = {
  enabled: boolean;
  token: string;
  botUsername: string | null;
  /** Display name shown in the chat list and the profile (`setMyName`, ≤64). */
  name: string | null;
  miniAppUrl: string | null;
  webhookSecret: string | null;
  adminId: string | null;
};

export type VkConfig = {
  enabled: boolean;
  token: string;
  groupId: string | null;
  callbackSecret: string | null;
  verifySignature: boolean;
  appId: string | null;
};

export type MaxConfig = {
  enabled: boolean;
  token: string;
  /** platform-api2.max.ru since 2026-07-19; the older host stays configurable. */
  baseUrl: string;
  webhookSecret: string | null;
};

function normalizeToken(raw: string): string {
  // Panels sometimes get "Bearer 123:ABC" pasted in; Telegram/VK/MAX want the raw token.
  return (raw || "").replace(/^bearer\s+/i, "").trim();
}

export async function telegramConfig(): Promise<TelegramConfig> {
  const token = normalizeToken(await getSettingOrEnv("telegram_bot_token", "TELEGRAM_BOT_TOKEN"));
  const botsEnabled = await getSettingBool("bots_enabled", true);
  const adminId = (await getSettingOrEnv("admin_telegram_id", "ADMIN_TELEGRAM_ID")) || null;
  return {
    enabled: botsEnabled && !!token,
    token,
    botUsername:
      (await getSettingOrEnv("telegram_bot_username", "TELEGRAM_BOT_USERNAME")).replace(/^@/, "") || null,
    // The name users see in the chat list: it must say "app", not "login".
    name: (await getSettingOrEnv("telegram_name", "TELEGRAM_BOT_NAME")).slice(0, 64) || null,
    miniAppUrl: (await getSettingOrEnv("telegram_mini_app_url", "TELEGRAM_MINI_APP_URL")) || null,
    webhookSecret: (await getSettingOrEnv("telegram_webhook_secret", "TELEGRAM_WEBHOOK_SECRET")) || null,
    adminId: adminId ? String(adminId).replace(/^\@/, "") : null,
  };
}

/**
 * Where the bot token comes from. The admin diagnostics show this, because a
 * token saved only in the panel (or only in the environment) is a frequent
 * reason one half of the product works while the other stays silent.
 */
export async function telegramTokenSource(): Promise<{ token: string; source: "panel" | "env" } | null> {
  const fromPanel = normalizeToken((await getSetting("telegram_bot_token")) || "");
  if (fromPanel) return { token: fromPanel, source: "panel" };
  const fromEnv = normalizeToken(cleanConnectionValue(process.env.TELEGRAM_BOT_TOKEN || ""));
  if (fromEnv) return { token: fromEnv, source: "env" };
  return null;
}

export async function vkConfig(): Promise<VkConfig> {
  const token = normalizeToken(await getSettingOrEnv("vk_access_token", "VK_ACCESS_TOKEN"));
  const botsEnabled = await getSettingBool("bots_enabled", true);
  return {
    enabled: botsEnabled && !!token,
    token,
    groupId: (await getSettingOrEnv("vk_group_id", "VK_GROUP_ID")) || null,
    callbackSecret: (await getSettingOrEnv("vk_callback_secret", "VK_CALLBACK_SECRET")) || null,
    verifySignature: (await getSettingOrEnv("vk_verify_signature")) !== "0",
    appId: (await getSettingOrEnv("vk_mini_app_id", "VK_MINI_APP_ID")) || null,
  };
}

export async function maxConfig(): Promise<MaxConfig> {
  const token = normalizeToken(await getSettingOrEnv("max_bot_token", "MAX_BOT_TOKEN"));
  const botsEnabled = await getSettingBool("bots_enabled", true);
  const baseUrl =
    (await getSettingOrEnv("max_base_url", "MAX_API_BASE_URL")) || "https://platform-api2.max.ru";
  return {
    enabled: botsEnabled && !!token,
    token,
    baseUrl: baseUrl.replace(/\/+$/, ""),
    webhookSecret: (await getSettingOrEnv("max_webhook_secret", "MAX_WEBHOOK_SECRET")) || null,
  };
}

export async function platformConfig(platform: BotPlatform) {
  if (platform === "telegram") return telegramConfig();
  if (platform === "vk") return vkConfig();
  return maxConfig();
}

/**
 * Absolute origin of this deployment.
 *
 * Bots need full URLs (Telegram Mini App buttons, images in messages), and the
 * request host is only trustworthy behind our own proxy, so the admin setting
 * `public_base_url` (or PUBLIC_BASE_URL) always wins.
 */
export async function publicBaseUrl(hostHint?: string | null): Promise<string> {
  const configured = await getSettingOrEnv("public_base_url", "PUBLIC_BASE_URL");
  if (configured) return configured.replace(/\/+$/, "");
  if (hostHint) {
    const proto = hostHint.startsWith("localhost") || hostHint.startsWith("127.0.0.1") ? "http" : "https";
    return `${proto}://${hostHint}`;
  }
  const port = process.env.PORT || "3000";
  return `http://localhost:${port}`;
}

export async function appUrl(hostHint?: string | null): Promise<string> {
  const base = await publicBaseUrl(hostHint);
  const tg = await getSettingOrEnv("telegram_mini_app_url");
  return (tg || `${base}/app`).replace(/\/+$/, "");
}

export async function linkTtlMs(): Promise<number> {
  const raw = await getSettingOrEnv("bots_link_ttl_min");
  const n = Number(raw);
  const minutes = Number.isFinite(n) && n > 0 ? n : 60;
  return minutes * 60 * 1000;
}

/** Is the given Telegram user the service owner (auto-admin)? */
export async function isOwnerTelegramId(id: string | number | null | undefined): Promise<boolean> {
  if (id === null || id === undefined || id === "") return false;
  const cfg = await telegramConfig();
  if (!cfg.adminId) return false;
  return String(cfg.adminId) === String(id);
}

/** Extra owner ids (any platform), comma separated. */
export async function ownerIds(platform: BotPlatform): Promise<Set<string>> {
  const key = `owner_ids_${platform}`;
  const raw = await getSettingOrEnv(key, key.toUpperCase());
  const set = new Set(
    (raw || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
  );
  if (platform === "telegram" && (await telegramConfig()).adminId) set.add(String((await telegramConfig()).adminId));
  return set;
}

export type PlatformStatus = {
  platform: BotPlatform;
  enabled: boolean;
  configured: boolean;
  detail: string | null;
  /** Filled by the caller after a live `getMe`-style check. */
  me?: { username?: string | null; name?: string | null; id?: string | null } | null;
  webhook?: string | null;
  error?: string | null;
};

export async function platformsStatus(): Promise<PlatformStatus[]> {
  const tg = await telegramConfig();
  const vk = await vkConfig();
  const mx = await maxConfig();
  const botsEnabled = await getSettingBool("bots_enabled", true);
  return [
    {
      platform: "telegram",
      enabled: botsEnabled,
      configured: !!tg.token,
      detail: tg.botUsername ? `@${tg.botUsername}` : null,
    },
    { platform: "vk", enabled: botsEnabled, configured: !!vk.token, detail: vk.groupId ? `группа ${vk.groupId}` : null },
    {
      platform: "max",
      enabled: botsEnabled,
      configured: !!mx.token,
      detail: mx.baseUrl.replace(/^https:\/\//, ""),
    },
  ];
}
