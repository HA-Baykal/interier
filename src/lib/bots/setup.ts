/**
 * One-command bot setup.
 *
 * Registers webhooks (Telegram `setWebhook`, MAX `POST /subscriptions`, VK
 * Callback API), the Telegram Mini App menu button and the command list, so the
 * owner only has to paste tokens in the admin panel and press "Подключить".
 */

import { randomBytes } from "crypto";
import { getSetting, getSettingBool, getSettingOrEnv, setSetting } from "../config";
import { RequestError } from "../errors";
import { t as tr } from "../i18n";
import { BotPlatform } from "../types";
import { appUrl, maxConfig, platformsStatus, publicBaseUrl, telegramConfig, telegramTokenSource, vkConfig } from "./config";

/**
 * One URL per platform. Telegram shares the login route on purpose: a single
 * webhook carries both the `auth_` confirmations and the bot-application
 * updates, so BotFather never needs to be repointed when features grow.
 */
export function webhookPath(platform: BotPlatform): string {
  return platform === "telegram" ? "/api/auth/telegram/webhook" : `/api/bots/${platform}/webhook`;
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

/** Profile fields that were pushed to Telegram (labels of applied Bot API calls). */
export type ProfileResult = { ok: boolean; applied: string[]; errors: string[]; name: string | null; menuButtonUrl: string | null };

/**
 * Push the bot's *profile*: the name in the chat list, the «About» texts, the
 * command list and the Mini App menu button. A user reads all of this before
 * typing a single message, so this is what turns «бот подтверждает вход» into
 * «здесь делают дизайн интерьера». Never touches the webhook.
 */
export async function applyTelegramProfile(hostHint?: string | null): Promise<ProfileResult> {
  const cfg = await telegramConfig();
  const app = await appUrl(hostHint);
  if (!cfg.token) return { ok: false, applied: [], errors: ["TELEGRAM_BOT_TOKEN не задан (админка → Боты или env)"], name: null, menuButtonUrl: app };

  const { tgApplyProfile } = await import("./telegram");
  const result = await tgApplyProfile({
    name: cfg.name,
    description: tr("ru", "bot_profile_description"),
    descriptionEn: tr("en", "bot_profile_description"),
    shortDescription: tr("ru", "bot_profile_short"),
    shortDescriptionEn: tr("en", "bot_profile_short"),
    menuButtonText: tr("ru", "bot_profile_menu"),
    menuButtonUrl: app,
  });

  if (!cfg.miniAppUrl) await setSetting("telegram_mini_app_url", app);
  if (!cfg.botUsername) {
    const { tgMe } = await import("./telegram");
    const me = await tgMe();
    if (me?.username) await setSetting("telegram_bot_username", me.username);
  }
  // Proof for the admin panel that the profile was actually pushed.
  if (result.applied.length) await setSetting("telegram_profile_applied", String(Date.now()));
  return { ok: result.errors.length === 0, applied: result.applied, errors: result.errors, name: cfg.name, menuButtonUrl: app };
}

export async function setupTelegram(hostHint?: string | null): Promise<SetupResult> {
  const cfg = await telegramConfig();
  if (!cfg.token) return { ok: false, error: "TELEGRAM_BOT_TOKEN не задан (админка → Боты или env)" };
  await ensureWebhookSecret("telegram_webhook_secret");

  // The webhook itself belongs to the login transport: both share the single
  // URL /api/auth/telegram/webhook, which forwards every non-login update to
  // this engine. Reaching Telegram is the admin's explicit action, therefore
  // an existing webhook may be replaced (previous deployments are stale).
  const { connectTelegram } = await import("@/lib/telegram/connection");
  let url: string | undefined;
  try {
    // Never silently steal a webhook that belongs to another deployment: the
    // takeover has to be confirmed in the Telegram block of the admin panel.
    const conn = await connectTelegram(false);
    url = conn.publicOrigin ? `${conn.publicOrigin}${webhookPath("telegram")}` : undefined;
  } catch (e) {
    const code = e instanceof RequestError ? e.code : "";
    const message =
      code === "telegram_webhook_in_use"
        ? "У бота уже другой webhook. Подтвердите переключение в блоке «Telegram» на странице /admin (там же, где проверка getMe)."
        : e instanceof Error
        ? e.message
        : "Telegram connect failed";
    return { ok: false, error: message, url };
  }

  // The bot's menu button opens our mini app — this is what makes it "an app".
  const profile = await applyTelegramProfile(hostHint);
  if (!profile.ok) console.error("[bots] telegram profile:", profile.errors.join("; "));
  return {
    ok: true,
    url,
    detail: `@${(await telegramConfig()).botUsername || "?"}${profile.applied.length ? ` · профиль: ${profile.applied.join(", ")}` : ""}`,
  };
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

/**
 * Which setting produced the public address of this deployment. A webhook that
 * points to a Preview almost always comes from `VERCEL_BRANCH_URL`, which is
 * different for every deployment — the admin panel says so explicitly.
 */
function originSource(): string | null {
  if (process.env.AUTH_PUBLIC_URL) return "AUTH_PUBLIC_URL";
  if (process.env.PUBLIC_BASE_URL) return "PUBLIC_BASE_URL";
  if (process.env.VERCEL_BRANCH_URL) return "VERCEL_BRANCH_URL";
  return null;
}

/** The webhook URL this deployment *would* register, plus its origin source. */
export async function telegramWebhookExpectation(hostHint?: string | null): Promise<{ expectedUrl: string | null; originSource: string | null }> {
  try {
    // The login transport owns the webhook and knows the canonical address
    // (AUTH_PUBLIC_URL → PUBLIC_BASE_URL → VERCEL_BRANCH_URL).
    const { telegramConfig: loginConfig } = await import("@/lib/telegram/config");
    const cfg = loginConfig();
    if (cfg.webhookUrl) return { expectedUrl: cfg.webhookUrl, originSource: originSource() };
  } catch {
    /* no token in the environment: fall back to the bots-side base URL */
  }
  const configured = await getSettingOrEnv("public_base_url", "PUBLIC_BASE_URL");
  const base = await publicBaseUrl(hostHint);
  return {
    expectedUrl: `${base}${webhookPath("telegram")}`,
    originSource: configured ? "PUBLIC_BASE_URL" : "REQUEST_HOST",
  };
}

/**
 * Everything needed to explain *why* the bot answers the way it does: is the
 * application half turned on at all, where does the token come from, is the
 * simulator (a debug door) left open on production.
 */
export async function botAppDiagnostics() {
  const [simulator, inline, enabled, profileApplied, tokenSource] = await Promise.all([
    getSetting("bots_simulator"),
    getSettingBool("bots_inline_generation", false),
    getSettingBool("bots_enabled", true),
    getSetting("telegram_profile_applied"),
    telegramTokenSource(),
  ]);
  const tg = await telegramConfig();
  return {
    botsEnabled: enabled,
    /** The app half of the bot answers only when both the switch and a token are there. */
    appEnabled: tg.enabled,
    simulator: (simulator || "0") === "1",
    inlineGeneration: inline,
    tokenSource: tokenSource?.source || null,
    name: tg.name,
    profileAppliedAt: profileApplied ? Number(profileApplied) : null,
  };
}
