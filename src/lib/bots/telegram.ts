/**
 * Telegram adapter: Bot API client, webhook normalization, Mini App (initData)
 * verification and outbound rendering.
 *
 * The bot is not a notification toy — it is the app: photos, style picker,
 * generation, the shopping list with marketplace links and the admin section all
 * run through the shared engine in `./engine`.
 */

import crypto from "crypto";
import { BotPlatform, Locale } from "../types";
import { BotButton, BotInbound, BotOutbound } from "./types";
import { telegramConfig } from "./config";

import { call, TELEGRAM_FILE_API } from "./telegramApi";

export type TgUser = {
  id: number;
  username?: string;
  first_name?: string;
  last_name?: string;
  language_code?: string;
};

export async function tgMe(): Promise<{ username: string | null; id: number | null } | null> {
  const cfg = await telegramConfig();
  if (!cfg.token) return null;
  try {
    const r = await call<{ result: { username?: string; id: number } }>(cfg.token, "getMe", {});
    return { username: r.result?.username || null, id: r.result?.id ?? null };
  } catch {
    return null;
  }
}

export async function tgSetWebhook(url: string, opts?: { dropPending?: boolean }): Promise<{ ok: boolean; error?: string }> {
  const cfg = await telegramConfig();
  if (!cfg.token) return { ok: false, error: "TELEGRAM_BOT_TOKEN is not set" };
  try {
    const payload: Record<string, unknown> = {
      url,
      allowed_updates: ["message", "callback_query", "inline_query", "chosen_inline_result"],
      drop_pending_updates: opts?.dropPending !== false,
    };
    if (cfg.webhookSecret) payload.secret_token = cfg.webhookSecret;
    await call(cfg.token, "setWebhook", payload);
    await tgSetCommands();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function tgDeleteWebhook(): Promise<{ ok: boolean; error?: string }> {
  const cfg = await telegramConfig();
  if (!cfg.token) return { ok: false, error: "no token" };
  try {
    await call(cfg.token, "deleteWebhook", { drop_pending_updates: false });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function tgWebhookInfo(): Promise<{ url: string | null; pending: number; lastError: string | null } | null> {
  const cfg = await telegramConfig();
  if (!cfg.token) return null;
  try {
    const r = await call<{ result: Record<string, any> }>(cfg.token, "getWebhookInfo", {});
    return { url: r.result?.url || null, pending: r.result?.pending_update_count || 0, lastError: r.result?.last_error_message || null };
  } catch {
    return null;
  }
}

const COMMANDS = [
  { command: "start", description: "Меню приложения" },
  { command: "new", description: "Создать дизайн по фото" },
  { command: "edit", description: "Изменить деталь (например, шторы)" },
  { command: "shop", description: "Где купить детали дизайна" },
  { command: "history", description: "Мои дизайны" },
  { command: "app", description: "Открыть приложение" },
  { command: "credits", description: "Баланс генераций" },
  { command: "help", description: "Как это работает" },
  { command: "cancel", description: "Отменить текущий шаг" },
];

export async function tgSetCommands(): Promise<void> {
  const cfg = await telegramConfig();
  if (!cfg.token) return;
  try {
    await call(cfg.token, "setMyCommands", { commands: COMMANDS });
  } catch {
    /* non-fatal */
  }
}

/** What the bot's profile in Telegram should say. */
export type TelegramProfile = {
  /** `setMyName` — ≤64 characters. */
  name?: string | null;
  description?: string | null;
  descriptionEn?: string | null;
  shortDescription?: string | null;
  shortDescriptionEn?: string | null;
  menuButtonText?: string | null;
  menuButtonUrl?: string | null;
};

/**
 * Push the profile to Telegram: name, «About» texts, command list and the Mini
 * App menu button. This is what a user reads *before* writing to the bot, so it
 * is the difference between «бот подтверждает вход» and «здесь делают дизайн».
 * Every call is independent: an old Bot API server may reject one of them.
 */
export async function tgApplyProfile(profile: TelegramProfile): Promise<{ applied: string[]; errors: string[] }> {
  const cfg = await telegramConfig();
  if (!cfg.token) return { applied: [], errors: ["TELEGRAM_BOT_TOKEN is not set"] };

  const planned: { label: string; method: string; payload: Record<string, unknown> }[] = [];
  if (profile.name) planned.push({ label: "name", method: "setMyName", payload: { name: profile.name.slice(0, 64) } });
  if (profile.description) {
    planned.push({ label: "description", method: "setMyDescription", payload: { description: profile.description.slice(0, 512) } });
  }
  if (profile.descriptionEn) {
    planned.push({
      label: "description_en",
      method: "setMyDescription",
      payload: { description: profile.descriptionEn.slice(0, 512), language_code: "en" },
    });
  }
  if (profile.shortDescription) {
    planned.push({ label: "short_description", method: "setMyShortDescription", payload: { short_description: profile.shortDescription.slice(0, 120) } });
  }
  if (profile.shortDescriptionEn) {
    planned.push({
      label: "short_description_en",
      method: "setMyShortDescription",
      payload: { short_description: profile.shortDescriptionEn.slice(0, 120), language_code: "en" },
    });
  }
  planned.push({ label: "commands", method: "setMyCommands", payload: { commands: COMMANDS } });
  if (profile.menuButtonUrl) {
    planned.push({
      label: "menu_button",
      method: "setChatMenuButton",
      payload: {
        menu_button: { type: "web_app", text: (profile.menuButtonText || "Открыть приложение").slice(0, 30), web_view_url: profile.menuButtonUrl },
      },
    });
  }

  const applied: string[] = [];
  const errors: string[] = [];
  for (const step of planned) {
    try {
      await call(cfg.token, step.method, step.payload);
      applied.push(step.label);
    } catch (e) {
      errors.push(`${step.method}: ${e instanceof Error ? e.message.slice(0, 160) : String(e)}`);
    }
  }
  return { applied, errors };
}

/** Long-polling helper used by the dev worker (`npm run bots:poll`). */
export async function tgGetUpdates(offset: number | null, timeout = 25) {
  const cfg = await telegramConfig();
  if (!cfg.token) return [];
  const payload: Record<string, unknown> = { timeout, limit: 50, allowed_updates: ["message", "callback_query"] };
  if (offset) payload.offset = offset + 1;
  const r = await call<{ result: any[] }>(cfg.token, "getUpdates", payload);
  return r.result || [];
}

/* ------------------------------------------------------------------ */
/* Inbound                                                             */
/* ------------------------------------------------------------------ */

function tgLocale(code?: string): Locale {
  return code && code.startsWith("ru") ? "ru" : code ? "en" : "ru";
}

async function downloadTgFile(token: string, filePath: string): Promise<{ buffer: Buffer; mime: string } | null> {
  try {
    const res = await fetch(`${TELEGRAM_FILE_API}/bot${token}/${filePath}`);
    if (!res.ok) return null;
    const buffer = Buffer.from(await res.arrayBuffer());
    const ext = filePath.split(".").pop()?.toLowerCase() || "jpg";
    const mime = ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg";
    return { buffer, mime };
  } catch {
    return null;
  }
}

/** Turn a Telegram `update` object into our normalized inbound. */
export async function normalizeTelegramUpdate(update: any): Promise<BotInbound | null> {
  const cfg = await telegramConfig();
  const msg = update?.message || update?.edited_message || update?.channel_post;
  const cb = update?.callback_query;

  if (cb?.data) {
    const from: TgUser = cb.from || {};
    const m = cb.message || {};
    return {
      platform: "telegram" as BotPlatform,
      chatId: String(m.chat?.id ?? from.id ?? ""),
      externalId: String(from.id ?? ""),
      username: from.username || null,
      displayName: [from.first_name, from.last_name].filter(Boolean).join(" ") || null,
      locale: tgLocale(from.language_code),
      text: null,
      action: String(cb.data).trim(),
      callbackId: cb.id ? String(cb.id) : null,
      messageId: m.message_id ? String(m.message_id) : null,
      isGroup: m.chat?.type === "group" || m.chat?.type === "supergroup" || m.chat?.type === "channel",
      raw: update,
    };
  }

  if (!msg) return null;
  const from: TgUser = msg.from || {};
  const text: string | null = typeof msg.text === "string" ? msg.text : typeof msg.caption === "string" ? msg.caption : null;

  const photos: { buffer: Buffer; mime: string }[] = [];
  if (Array.isArray(msg.photo) && msg.photo.length && cfg.token) {
    const best = msg.photo[msg.photo.length - 1];
    try {
      const f = await call<{ result: { file_path?: string } }>(cfg.token, "getFile", { file_id: best.file_id });
      const path = f.result?.file_path;
      if (path) {
        const file = await downloadTgFile(cfg.token, path);
        if (file) photos.push(file);
      }
    } catch (e) {
      console.warn("[telegram] photo download failed:", e instanceof Error ? e.message : e);
    }
  }

  return {
    platform: "telegram",
    chatId: String(msg.chat?.id ?? ""),
    externalId: String(from.id ?? msg.chat?.id ?? ""),
    username: from.username || null,
    displayName: [from.first_name, from.last_name].filter(Boolean).join(" ") || null,
    locale: tgLocale(from.language_code),
    text,
    photos,
    messageId: msg.message_id ? String(msg.message_id) : null,
    isGroup: msg.chat?.type === "group" || msg.chat?.type === "supergroup" || msg.chat?.type === "channel",
    raw: update,
  };
}

export async function answerCallback(id: string | null | undefined, text?: string, alert = false): Promise<void> {
  if (!id) return;
  const cfg = await telegramConfig();
  if (!cfg.token) return;
  try {
    await call(cfg.token, "answerCallbackQuery", {
      callback_query_id: id,
      ...(text ? { text: text.slice(0, 190), show_alert: alert } : {}),
    });
  } catch {
    /* toasts are cosmetic */
  }
}

/* ------------------------------------------------------------------ */
/* Outbound                                                            */
/* ------------------------------------------------------------------ */

function renderButton(b: BotButton): Record<string, unknown> | null {
  switch (b.kind) {
    case "callback":
      return { text: b.text.slice(0, 64), callback_data: b.action.slice(0, 64) };
    case "app":
      // web_app is only valid for bots with a registered Mini App; fall back to url.
      return { text: b.text.slice(0, 64), web_app: { url: b.url } };
    case "link":
      return { text: b.text.slice(0, 64), url: b.url };
    default:
      return null;
  }
}

export function telegramKeyboard(rows: BotButton[][] | undefined) {
  if (!rows || !rows.length) return undefined;
  const kb = rows
    .map((r) => r.map(renderButton).filter(Boolean) as Record<string, unknown>[])
    .filter((r) => r.length);
  return kb.length ? { inline_keyboard: kb } : undefined;
}

export type TgSendResult = { messageId: string | null };

export async function telegramSend(chatId: string, out: BotOutbound): Promise<TgSendResult> {
  const cfg = await telegramConfig();
  if (!cfg.token) throw new Error("TELEGRAM_BOT_TOKEN is not set");

  const reply_markup = telegramKeyboard(out.buttons);
  const text = (out.text || "").slice(0, 3800);
  let messageId: string | null = null;

  if (out.photoUrl && /^https?:\/\//.test(out.photoUrl)) {
    const r = await call<{ result: { message_id: number } }>(cfg.token, "sendPhoto", {
      chat_id: chatId,
      photo: out.photoUrl,
      caption: text || undefined,
      disable_web_page_preview: true,
      ...(out.silent ? { disable_notification: true } : {}),
      ...(reply_markup ? { reply_markup } : {}),
    });
    messageId = r.result?.message_id ? String(r.result.message_id) : null;
    return { messageId };
  }

  if (!text && out.photoUrl) {
    // Relative image URL and no text: send the link so the user still sees the result.
    const r = await call<{ result: { message_id: number } }>(cfg.token, "sendMessage", {
      chat_id: chatId,
      text: out.photoUrl,
      disable_web_page_preview: false,
      ...(reply_markup ? { reply_markup } : {}),
    });
    return { messageId: r.result?.message_id ? String(r.result.message_id) : null };
  }

  if (out.editMessageId) {
    try {
      await call(cfg.token, "editMessageText", {
        chat_id: chatId,
        message_id: out.editMessageId,
        text: text || "…",
        ...(reply_markup ? { reply_markup } : {}),
      });
      return { messageId: out.editMessageId };
    } catch {
      /* fall through to a fresh message */
    }
  }

  const r = await call<{ result: { message_id: number } }>(cfg.token, "sendMessage", {
    chat_id: chatId,
    text: text || "…",
    disable_web_page_preview: true,
    ...(out.silent ? { disable_notification: true } : {}),
    ...(reply_markup ? { reply_markup } : {}),
  });
  return { messageId: r.result?.message_id ? String(r.result.message_id) : null };
}

export async function tgSendChatAction(chatId: string, action = "typing"): Promise<void> {
  const cfg = await telegramConfig();
  if (!cfg.token) return;
  try {
    await call(cfg.token, "sendChatAction", { chat_id: chatId, action });
  } catch {
    /* cosmetic */
  }
}

/**
 * Real membership check for the "+1 за подписку на канал" bonus.
 * Needs the channel id/username and the bot to be an admin there.
 * Returns null when nothing is configured (→ the demo behaviour of the site).
 */
export async function verifyChannelMembership(userId: string): Promise<boolean | null> {
  const cfg = await telegramConfig();
  const channel = await getSettingChannel();
  if (!cfg.token || !channel) return null;
  try {
    const r = await call<{ result: { status?: string } }>(cfg.token, "getChatMember", {
      chat_id: channel,
      user_id: Number(userId),
    });
    const status = (r.result?.status || "").toLowerCase();
    return ["member", "administrator", "creator"].includes(status);
  } catch {
    return null;
  }
}

async function getSettingChannel(): Promise<string | null> {
  const { getSetting } = await import("../config");
  const v = await getSetting("telegram_channel_id");
  return v && v.trim() ? v.trim() : null;
}

/* ------------------------------------------------------------------ */
/* Mini App: initData verification (official algorithm)               */
/* ------------------------------------------------------------------ */

export type TgWebAppUser = {
  id: number;
  username: string | null;
  name: string;
  locale: Locale;
  isPremium: boolean;
  raw: Record<string, unknown>;
};

/**
 * Verify `window.Telegram.WebApp.initData`.
 *
 * secret = HMAC_SHA256(key="WebAppData", data=botToken)
 * check  = HMAC_SHA256(key=secret, data=sorted "k=v" lines without `hash`)
 */
export function verifyTelegramInitData(initData: string, token?: string, maxAgeSec = 24 * 3600): TgWebAppUser | null {
  const cfgToken = token;
  return verifyInitDataSync(initData, cfgToken, maxAgeSec);
}

/** Split out for tests: the token is passed explicitly. */
export function verifyInitDataSync(
  initData: string,
  botToken: string | undefined | null,
  maxAgeSec = 24 * 3600,
  nowSec = Math.floor(Date.now() / 1000)
): TgWebAppUser | null {
  if (!initData || !botToken) return null;
  let params: URLSearchParams;
  try {
    params = new URLSearchParams(initData);
  } catch {
    return null;
  }
  const hash = params.get("hash");
  if (!hash) return null;

  const pairs: string[] = [];
  for (const [k, v] of params.entries()) {
    if (k === "hash") continue;
    pairs.push(`${k}=${v}`);
  }
  pairs.sort();
  const dataCheckString = pairs.join("\n");

  const secret = crypto.createHmac("sha256", "WebAppData").update(botToken).digest();
  const calc = crypto.createHmac("sha256", secret).update(dataCheckString).digest("hex");

  const a = Buffer.from(calc, "hex");
  const b = Buffer.from(hash, "hex");
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

  const authDate = Number(params.get("auth_date") || 0);
  if (authDate && nowSec - authDate > maxAgeSec) return null;

  let user: any = null;
  try {
    user = JSON.parse(params.get("user") || "null");
  } catch {
    user = null;
  }
  if (!user?.id) return null;

  return {
    id: Number(user.id),
    username: typeof user.username === "string" ? user.username : null,
    name: [user.first_name, user.last_name].filter(Boolean).join(" ") || user.username || String(user.id),
    locale: typeof user.language_code === "string" && user.language_code.startsWith("ru") ? "ru" : "en",
    isPremium: !!user.is_premium,
    raw: Object.fromEntries(params.entries()),
  };
}
