/**
 * VK adapter (community bot + Callback API).
 *
 * VK keyboards are less expressive than Telegram's, so a callback action is sent
 * both as a machine payload and as a human label we can fall back to — the chat
 * keeps the label→action map, which makes button presses reliable even if the
 * payload is delivered differently by the platform.
 */

import crypto from "crypto";
import { BotInbound, BotOutbound, BotButton } from "./types";
import { BotPlatform } from "../types";
import { vkConfig } from "./config";

const API = "https://api.vk.com/method";
const VERSION = "5.199";

export type VkKeyboardButton = {
  action: { type: "text" | "callback" | "open_link" | "start"; label: string; payload?: string; link?: string };
  color: "primary" | "positive" | "negative" | "neutral" | "white";
};

export type VkKeyboard = {
  one_time: boolean;
  inline: boolean;
  buttons: VkKeyboardButton[][];
};

export function vkKeyboard(rows: BotButton[][] | undefined, map: Record<string, string>): VkKeyboard | null {
  if (!rows || !rows.length) return null;
  const buttons: VkKeyboardButton[][] = [];
  for (const row of rows.slice(0, 10)) {
    const out: VkKeyboardButton[] = [];
    for (const b of row.slice(0, 5)) {
      const label = b.text.slice(0, 40);
      if (b.kind === "link" || b.kind === "app") {
        out.push({ action: { type: "open_link", label, link: b.url }, color: b.kind === "app" ? "primary" : "neutral" });
        continue;
      }
      // Remember the label so a text-action fallback still resolves the action.
      if (b.kind === "callback") map[label.toLowerCase()] = b.action;
      out.push({
        action: { type: "callback", label, payload: JSON.stringify({ a: b.kind === "callback" ? b.action : b.text }) },
        color: "primary",
      });
    }
    if (out.length) buttons.push(out);
  }
  if (!buttons.length) return null;
  return { one_time: false, inline: false, buttons };
}

/* ------------------------------------------------------------------ */
/* API                                                                 */
/* ------------------------------------------------------------------ */

/** Generic VK API call (used by setup, the admin panel and the engine). */
export async function vkApi<T = any>(method: string, params: Record<string, unknown> = {}): Promise<T> {
  return api<T>(method, params);
}

async function api<T = any>(method: string, params: Record<string, unknown>): Promise<T> {
  const cfg = await vkConfig();
  if (!cfg.token) throw new Error("VK_ACCESS_TOKEN is not set");
  const body = new URLSearchParams();
  body.set("access_token", cfg.token);
  body.set("v", VERSION);
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null) continue;
    body.set(k, typeof v === "string" ? v : JSON.stringify(v));
  }
  const res = await fetch(`${API}/${method}`, { method: "POST", body });
  const json = await res.json().catch(() => null);
  if (!res.ok || (json as any)?.error) {
    const err = (json as any)?.error;
    throw new Error(`VK ${method} failed (${err?.error_code || res.status}): ${err?.error_msg || "error"}`);
  }
  return json as T;
}

export async function vkMe(): Promise<{ name: string | null; id: string | null } | null> {
  const cfg = await vkConfig();
  if (!cfg.token || !cfg.groupId) return null;
  try {
    const r = await api<{ response: { id: number; name: string }[] }>("groups.getById", { group_id: cfg.groupId });
    const g = r.response?.[0];
    return g ? { name: g.name, id: String(g.id) } : null;
  } catch {
    return null;
  }
}

export async function vkSetCallbackServer(url: string): Promise<{ ok: boolean; error?: string; serverId?: string }> {
  const cfg = await vkConfig();
  if (!cfg.token || !cfg.groupId) return { ok: false, error: "нужны VK_ACCESS_TOKEN и VK_GROUP_ID" };
  try {
    const list = await api<{ response: { items: { server_id: number; url: string }[] } }>("groups.getCallbackServers", {
      group_id: cfg.groupId,
    });
    const existing = list.response?.items?.find((s) => s.url === url);
    if (existing) {
      await api("groups.setCallbackSettings", {
        group_id: cfg.groupId,
        server_id: existing.server_id,
        message_new: 1,
        message_reply: 1,
        message_edit: 1,
        photo_comment_new: 0,
        wall_reply_new: 0,
      });
      return { ok: true, serverId: String(existing.server_id) };
    }
    const created = await api<{ response: { server_id: number } }>("groups.addCallbackServer", {
      group_id: cfg.groupId,
      url,
      title: "Interier",
      secret_key: cfg.callbackSecret || undefined,
    });
    await api("groups.setCallbackSettings", {
      group_id: cfg.groupId,
      server_id: created.response?.server_id,
      message_new: 1,
      message_reply: 1,
      message_edit: 1,
    });
    return { ok: true, serverId: String(created.response?.server_id || "") };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

async function send(params: Record<string, unknown>): Promise<number | null> {
  const r = await api<{ response: number }>("messages.send", {
    random_id: Math.floor(Math.random() * 1e9),
    ...params,
  });
  return typeof r.response === "number" ? r.response : null;
}

async function typing(peerId: string): Promise<void> {
  const cfg = await vkConfig();
  try {
    await api("messages.setActivity", { type: "typing", peer_id: peerId, group_id: cfg.groupId || undefined });
  } catch {
    /* cosmetic */
  }
}

/**
 * Upload an image so it can be attached to a message.
 * Returns the VK attachment string (`photo{owner}_{id}`) or null.
 */
export async function vkUploadImage(peerId: string, buffer: Buffer, filename = "design.jpg"): Promise<string | null> {
  const cfg = await vkConfig();
  if (!cfg.token || !cfg.groupId) return null;
  try {
    const server = await api<{ response: { upload_url: string } }>("photos.getMessagesUploadServer", { group_id: cfg.groupId });
    const form = new FormData();
    const blob = new Blob([new Uint8Array(buffer)], { type: "image/jpeg" });
    form.append("photo", blob, filename);
    const up = await fetch(server.response.upload_url, { method: "POST", body: form });
    if (!up.ok) return null;
    const data = await up.json();
    const saved = await api<{ response: { photo: { pid?: number; id?: number; owner_id: number }[] } }>("photos.save", {
      photo: data.photo,
      server: data.server,
      hash: data.hash,
      group_id: cfg.groupId,
    });
    const p = saved.response?.photo?.[0];
    if (!p) return null;
    return `photo${p.owner_id}_${p.pid ?? p.id}`;
  } catch (e) {
    console.warn("[vk] image upload failed:", e instanceof Error ? e.message : e);
    return null;
  }
}

/** Resolve an image reference of ours into bytes for uploading to VK. */
async function fetchImageBytes(url: string): Promise<Buffer | null> {
  try {
    const res = await fetch(url, { headers: { Accept: "image/*" } });
    if (!res.ok) return null;
    return Buffer.from(await res.arrayBuffer());
  } catch {
    return null;
  }
}

export async function vkSend(
  chatId: string,
  out: BotOutbound,
  labels?: Record<string, string>
): Promise<{ messageId: string | null; labels: Record<string, string> }> {
  const peerId = chatId;
  await typing(peerId);

  const map = labels || {};
  const keyboard = vkKeyboard(out.buttons, map);

  const params: Record<string, unknown> = { user_id: chatId };
  const text = (out.text || "").trim();

  if (out.photoUrl) {
    const { publicBaseUrl } = await import("./config");
    const base = await publicBaseUrl(null);
    const abs = /^https?:/.test(out.photoUrl) ? out.photoUrl : `${base}${out.photoUrl}`;
    const bytes = await fetchImageBytes(abs);
    const attachment = bytes ? await vkUploadImage(peerId, bytes) : null;
    if (attachment) {
      params.attachment = attachment;
      if (text) params.message = text.slice(0, 3500);
    } else if (text) {
      params.message = `${text}\n${abs}`;
    } else {
      params.message = abs;
    }
  } else {
    params.message = text.slice(0, 3500) || "…";
  }

  if (keyboard) params.keyboard = JSON.stringify(keyboard);

  const id = await send(params);
  return { messageId: id ? String(id) : null, labels: map };
}

/* ------------------------------------------------------------------ */
/* Callback API                                                        */
/* ------------------------------------------------------------------ */

/**
 * Signature check as documented by VK: SHA-256 over the JSON of the payload
 * without `signature` (keys sorted, compact) with the secret appended.
 */
export function verifyVkSignature(body: Record<string, unknown>, secret: string): boolean {
  if (!secret) return true;
  const signature = typeof body.signature === "string" ? body.signature : null;
  if (!signature) return false;
  const copy: Record<string, unknown> = { ...body };
  delete copy.signature;
  const sorted = stableStringify(copy);
  const calc = crypto.createHash("sha256").update(`${sorted}${secret}`, "utf8").digest("hex");
  try {
    return crypto.timingSafeEqual(Buffer.from(calc), Buffer.from(signature));
  } catch {
    return calc === signature;
  }
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(stableStringify).join(",") + "]";
  const keys = Object.keys(value as Record<string, unknown>).sort();
  return "{" + keys.map((k) => `${JSON.stringify(k)}:${stableStringify((value as Record<string, unknown>)[k])}`).join(",") + "}";
}

function pickText(o: any): string | null {
  const t = o?.text;
  if (typeof t !== "string") return null;
  return t;
}

/** Parse a `message_new` callback body into our inbound update. */
export async function normalizeVkUpdate(
  body: any,
  labels: Record<string, string> = {}
): Promise<BotInbound | null> {
  if (body?.type !== "message_new" && body?.type !== "message_reply" && body?.type !== "message_edit") return null;
  const msg = body.object?.message || body.object || {};
  const fromId = msg.from_id ?? body.object?.from_id;
  const peerId = msg.peer_id ?? body.object?.peer_id;
  if (!fromId || !peerId) return null;

  let action: string | null = null;
  const rawPayload = msg.payload ?? body.object?.payload;
  if (typeof rawPayload === "string" && rawPayload.trim()) {
    try {
      const parsed = JSON.parse(rawPayload);
      if (typeof parsed?.a === "string") action = parsed.a;
    } catch {
      /* ignore malformed payload */
    }
  }

  const photos: { buffer: Buffer; mime: string }[] = [];
  const atts = Array.isArray(msg.attachments) ? msg.attachments : [];
  for (const a of atts) {
    if (a?.type !== "photo") continue;
    const p = a.photo;
    const sizes = Array.isArray(p?.sizes) ? p.sizes : [];
    const best = [...sizes].sort((x: any, y: any) => (y.width || 0) - (x.width || 0))[0];
    const url = best?.url || p?.photo_807 || p?.photo_604;
    if (!url) continue;
    const bytes = await fetchImageBytes(url);
    if (bytes) photos.push({ buffer: bytes, mime: "image/jpeg" });
  }

  const text = pickText(msg);
  const lower = (text || "").trim().toLowerCase();
  if (!action && lower && labels[lower]) action = labels[lower];

  return {
    platform: "vk" as BotPlatform,
    chatId: String(peerId),
    externalId: String(fromId),
    username: msg.username || null,
    displayName: [msg.first_name, msg.last_name].filter(Boolean).join(" ") || null,
    locale: "ru",
    text,
    action,
    photos,
    messageId: msg.id ? String(msg.id) : null,
    isGroup: Number(peerId) > 2e9,
    raw: body,
  };
}

/** Name of the user for greetings (VK ids only otherwise). */
export async function vkUserName(userId: string): Promise<string | null> {
  try {
    const r = await api<{ response: { first_name?: string; last_name?: string }[] }>("users.get", {
      user_ids: userId,
      fields: "",
    });
    const u = r.response?.[0];
    if (!u) return null;
    return [u.first_name, u.last_name].filter(Boolean).join(" ") || null;
  } catch {
    return null;
  }
}
