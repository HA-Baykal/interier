/**
 * Telegram Bot & Mini App configuration.
 *
 * Values can live either in the environment (hosting panel) or in the
 * admin panel (DB setting wins).
 */

import { getSettingBool, getSettingOrEnv } from "../config";
import { BotPlatform } from "../types";

export type TelegramConfig = {
  enabled: boolean;
  token: string;
  botUsername: string | null;
  miniAppUrl: string | null;
  webhookSecret: string | null;
  adminId: string | null;
};

function normalizeToken(raw: string): string {
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
    miniAppUrl: (await getSettingOrEnv("telegram_mini_app_url", "TELEGRAM_MINI_APP_URL")) || null,
    webhookSecret: (await getSettingOrEnv("telegram_webhook_secret", "TELEGRAM_WEBHOOK_SECRET")) || null,
    adminId: adminId ? String(adminId).replace(/^\@/, "") : null,
  };
}

export async function platformConfig(platform: BotPlatform) {
  return telegramConfig();
}

/**
 * Absolute origin of this deployment.
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
  const raw = tg || base;
  return raw.replace(/\/app\/?$/, "").replace(/\/+$/, "") || base;
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

/** Extra owner ids, comma separated. */
export async function ownerIds(platform: BotPlatform = "telegram"): Promise<Set<string>> {
  const key = `owner_ids_${platform}`;
  const raw = await getSettingOrEnv(key, key.toUpperCase());
  const set = new Set(
    (raw || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
  );
  if ((await telegramConfig()).adminId) set.add(String((await telegramConfig()).adminId));
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
  const botsEnabled = await getSettingBool("bots_enabled", true);
  return [
    {
      platform: "telegram",
      enabled: botsEnabled,
      configured: !!tg.token,
      detail: tg.botUsername ? `@${tg.botUsername}` : null,
    },
  ];
}
