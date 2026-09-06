/**
 * MAX messenger adapter (platform-api2.max.ru, the host since 19 Jul 2026; the
 * legacy platform-api.max.ru stays as an automatic fallback).
 *
 * Auth is a raw `Authorization: <token>` header (no Bearer), buttons live in the
 * `inline_keyboard` attachment, and images can be sent by URL — which is exactly
 * how our designs leave the sandbox: absolute URLs built from `public_base_url`.
 */

import { BotInbound, BotOutbound, BotButton } from "./types";
import { maxConfig } from "./config";

async function call<T = any>(
  method: "GET" | "POST" | "PUT" | "DELETE",
  path: string,
  opts?: { query?: Record<string, unknown>; body?: Record<string, unknown>; absoluteBase?: string }
): Promise<T> {
  const cfg = await maxConfig();
  if (!cfg.token) throw new Error("MAX_BOT_TOKEN is not set");
  const bases = [opts?.absoluteBase, cfg.baseUrl, "https://platform-api.max.ru"].filter(
    (b, i, arr) => !!b && arr.indexOf(b) === i
  ) as string[];

  let lastErr: unknown = null;
  for (const base of bases) {
    const url = new URL(`${base}${path}`);
    for (const [k, v] of Object.entries(opts?.query || {})) {
      if (v === undefined || v === null) continue;
      url.searchParams.set(k, String(v));
    }
    try {
      const res = await fetch(url.toString(), {
        method,
        headers: { Authorization: cfg.token, "Content-Type": "application/json", Accept: "application/json" },
        ...(opts?.body ? { body: JSON.stringify(opts.body) } : {}),
      });
      const text = await res.text().catch(() => "");
      if (!res.ok) {
        lastErr = new Error(`MAX ${method} ${path} failed (${res.status}): ${text.slice(0, 200)}`);
        // A wrong host (TLS/cert/unknown) is worth retrying on the fallback base.
        if (res.status >= 500 || res.status === 404) continue;
        throw lastErr;
      }
      return (text ? JSON.parse(text) : {}) as T;
    } catch (e) {
      lastErr = e;
      const msg = e instanceof Error ? e.message : String(e);
      // Network/TLS problems → try the next base; a real API error → rethrow.
      if (/failed to fetch|socket|certificate|self.signed|tls/i.test(msg)) continue;
      throw e;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("MAX API unreachable");
}

export async function maxMe(): Promise<{ username: string | null; name: string | null; id: string | null } | null> {
  try {
    const r = await call<{ bot?: Record<string, any> }>("GET", "/me");
    const bot = r.bot || (r as any).user || {};
    return { username: bot.username || null, name: bot.name || null, id: bot.user_id ? String(bot.user_id) : null };
  } catch {
    return null;
  }
}

export async function maxSetSubscription(url: string, updateTypes?: string[]): Promise<{ ok: boolean; error?: string }> {
  const cfg = await maxConfig();
  if (!cfg.token) return { ok: false, error: "MAX_BOT_TOKEN is not set" };
  const body: Record<string, unknown> = {
    url,
    update_types: updateTypes || ["message_created", "message_callback", "bot_started", "message_edited"],
  };
  if (cfg.webhookSecret) body.secret = cfg.webhookSecret;
  try {
    await call("POST", "/subscriptions", { body });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function maxGetSubscriptions(): Promise<{ url: string | null; error?: string }> {
  try {
    const r = await call<{ subscriptions?: { url?: string }[] }>("GET", "/subscriptions");
    return { url: r.subscriptions?.[0]?.url || null };
  } catch (e) {
    return { url: null, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Long-polling, used by the local worker when no public webhook is available. */
export async function maxGetUpdates(marker: string | null, timeout = 30) {
  const cfg = await maxConfig();
  if (!cfg.token) return { updates: [] as any[], marker };
  const r = await call<{ updates?: any[]; marker?: string | number }>("GET", "/updates", {
    query: { limit: 50, timeout, ...(marker ? { marker } : {}) },
  });
  return { updates: r.updates || [], marker: r.marker !== undefined ? String(r.marker) : marker };
}

/* ------------------------------------------------------------------ */
/* Keyboard                                                            */
/* ------------------------------------------------------------------ */

function renderButton(b: BotButton): Record<string, unknown> | null {
  switch (b.kind) {
    case "callback":
      return { type: "callback", text: b.text.slice(0, 60), payload: b.action.slice(0, 120) };
    case "link":
    case "app":
      return { type: "link", text: b.text.slice(0, 60), url: b.url };
    default:
      return null;
  }
}

export function maxKeyboard(rows: BotButton[][] | undefined) {
  if (!rows || !rows.length) return null;
  const buttons = rows
    .slice(0, 10)
    .map((r) => r.slice(0, 6).map(renderButton).filter(Boolean) as Record<string, unknown>[])
    .filter((r) => r.length);
  if (!buttons.length) return null;
  return { type: "inline_keyboard", payload: { buttons } };
}

/* ------------------------------------------------------------------ */
/* Outbound                                                            */
/* ------------------------------------------------------------------ */

export async function maxSend(
  chatId: string,
  out: BotOutbound,
  opts?: { isGroup?: boolean }
): Promise<{ messageId: string | null }> {
  const attachments: Record<string, unknown>[] = [];
  const text = (out.text || "").slice(0, 3800);

  if (out.photoUrl) {
    const { publicBaseUrl } = await import("./config");
    const base = await publicBaseUrl(null);
    const abs = /^https?:/.test(out.photoUrl) ? out.photoUrl : `${base}${out.photoUrl}`;
    if (/^https?:/.test(abs)) attachments.push({ type: "image", payload: { url: abs } });
  }
  const kb = maxKeyboard(out.buttons);
  if (kb) attachments.push(kb);

  // Private dialogs are addressed by user_id, group chats and channels by chat_id.
  const query: Record<string, unknown> = opts?.isGroup ? { chat_id: chatId } : { user_id: chatId, chat_id: chatId };

  if (out.editMessageId) {
    try {
      await call("PUT", `/messages/${out.editMessageId}`, { body: { body: text || "…", attachments } });
      return { messageId: out.editMessageId };
    } catch {
      /* fall through: send a new message instead */
    }
  }

  const r = await call<{ message?: { message_id?: number | string } }>("POST", "/messages", {
    query,
    body: {
      text: text || undefined,
      ...(attachments.length ? { attachments } : {}),
      ...(out.silent ? { notify: false } : {}),
    },
  });
  const id = r.message?.message_id;
  return { messageId: id ? String(id) : null };
}

/* ------------------------------------------------------------------ */
/* Inbound                                                             */
/* ------------------------------------------------------------------ */

async function fetchImage(url: string): Promise<{ buffer: Buffer; mime: string } | null> {
  try {
    const res = await fetch(url, { headers: { Accept: "image/*" } });
    if (!res.ok) return null;
    const buffer = Buffer.from(await res.arrayBuffer());
    const mime = (res.headers.get("content-type") || "image/jpeg").split(";")[0];
    return { buffer, mime };
  } catch {
    return null;
  }
}

/** Normalize a MAX `Update` into our inbound shape. */
export async function normalizeMaxUpdate(update: any): Promise<BotInbound | null> {
  const type = update?.update_type;

  if (type === "message_callback") {
    const cb = update.callback || {};
    const msg = cb.message || {};
    return {
      platform: "max" as const,
      chatId: String(msg.recipient?.chat_id ?? msg.recipient?.user_id ?? cb.user_id ?? ""),
      externalId: String(cb.user_id ?? msg.sender_user_id ?? msg.recipient?.user_id ?? ""),
      username: cb.user?.username || null,
      displayName: cb.user?.name || null,
      locale: "ru",
      action: typeof cb.payload === "string" ? cb.payload : typeof cb.action_id === "string" ? cb.action_id : null,
      callbackId: cb.callback_id ? String(cb.callback_id) : null,
      messageId: msg.message_id ? String(msg.message_id) : null,
      raw: update,
    };
  }

  if (type === "message_created" || type === "message_edited") {
    const msg = update.message || {};
    const body = msg.body || {};
    const sender = msg.sender || update.user || {};
    const chatId = String(msg.recipient?.chat_id ?? msg.recipient?.user_id ?? sender.user_id ?? "");

    const photos: { buffer: Buffer; mime: string }[] = [];
    for (const a of body.attachments || []) {
      if (a?.type !== "image") continue;
      const url = a.payload?.url;
      if (typeof url === "string" && url) {
        const img = await fetchImage(url);
        if (img) photos.push(img);
      }
    }

    return {
      platform: "max",
      chatId,
      externalId: String(sender.user_id ?? msg.recipient?.user_id ?? chatId),
      username: sender.username || sender.nickname || null,
      displayName: sender.name || sender.first_name || null,
      locale: "ru",
      text: typeof body.text === "string" ? body.text : null,
      photos,
      messageId: msg.message_id ? String(msg.message_id) : null,
      isGroup: !!msg.recipient?.chat_id && msg.recipient?.chat_id !== msg.recipient?.user_id,
      raw: update,
    };
  }

  if (type === "bot_started" || type === "bot_added") {
    const user = update.user || {};
    const chatId = String(update.chat_id ?? user.user_id ?? "");
    return {
      platform: "max",
      chatId,
      externalId: String(user.user_id ?? chatId),
      username: user.username || null,
      displayName: user.name || null,
      locale: "ru",
      text: "/start",
      raw: update,
    };
  }

  return null;
}

/** Acknowledge a button press (removes the "loading" state, optional toast). */
export async function maxAnswerCallback(callbackId: string | null, notification?: string): Promise<void> {
  if (!callbackId) return;
  try {
    await call("POST", "/answers", {
      query: { callback_id: callbackId },
      body: notification ? { notification: notification.slice(0, 120) } : {},
    });
  } catch {
    /* cosmetic */
  }
}

export async function maxSendTyping(chatId: string): Promise<void> {
  try {
    await call("POST", `/chats/${chatId}/actions`, { body: { action: "typing" } });
  } catch {
    /* cosmetic */
  }
}
