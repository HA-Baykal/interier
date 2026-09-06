/**
 * Bot persistence: chat state, messenger ⇄ account linking, one-time web tokens.
 *
 * Bots create the *same* users the website does, so a design made in Telegram is
 * visible in the web account and vice versa — that is what "the bot is an app"
 * means here: one account, one balance, one history, many front-ends.
 */

import { db, mutate, now, uid } from "../db";
import { hashPassword } from "../auth";
import { getSettingNumber, getSetting } from "../config";
import { BotChat, BotPlatform, Locale, User } from "../types";
import { isOwnerTelegramId, linkTtlMs, ownerIds } from "./config";

const USER_FIELD = {
  telegram: { id: "telegramId", username: "telegramUsername" },
  vk: { id: "vkId", username: "vkUsername" },
  max: { id: "maxId", username: "maxUsername" },
} as const;

export function externalIdToNumber(id: string): number | null {
  const n = Number(id);
  return Number.isFinite(n) ? n : null;
}

/** Find the account that owns this messenger identity. */
export async function findUserByExternal(platform: BotPlatform, externalId: string): Promise<User | null> {
  const d = await db();
  const field = USER_FIELD[platform].id;
  return (
    d.users.find((u) => {
      const v = (u as unknown as Record<string, unknown>)[field];
      return v !== null && v !== undefined && String(v) === String(externalId);
    }) || null
  );
}

/**
 * Create the account a messenger identity gets on first contact.
 * `referralCode` comes from a deep link (t.me/bot?start=ref_ABC123).
 */
export async function createBotUser(
  platform: BotPlatform,
  externalId: string,
  opts: { username?: string | null; displayName?: string | null; referralCode?: string | null; locale?: Locale | null }
): Promise<{ user: User; created: boolean }> {
  const existing = await findUserByExternal(platform, externalId);
  if (existing) return { user: existing, created: false };

  const freeCredits = await getSettingNumber("free_credits", 0);
  const handle = (opts.username || String(externalId)).replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 32);
  const email = `${platform}_${externalId}@bot.interier.local`;

  const id = uid("usr");
  const referralCode = await uniqueReferralCode(handle);

  await mutate((d) => {
    const user: User = {
      id,
      email,
      passwordHash: hashPassword(uid("botpw")),
      name: (opts.displayName || opts.username || `User ${handle}`).slice(0, 48),
      createdAt: now(),
      credits: freeCredits,
      trialUsed: false,
      telegramId: platform === "telegram" ? externalIdToNumber(externalId) : null,
      telegramUsername: platform === "telegram" ? opts.username ?? null : null,
      vkId: platform === "vk" ? externalIdToNumber(externalId) : null,
      vkUsername: platform === "vk" ? opts.username ?? null : null,
      maxId: platform === "max" ? externalIdToNumber(externalId) : null,
      maxUsername: platform === "max" ? opts.username ?? null : null,
      origin: platform,
      prefLocale: opts.locale ?? null,
      referralCode,
      referredBy: null,
      isAdmin: false,
    };
    d.users.push(user);
  });

  const created = (await db()).users.find((u) => u.id === id)!;

  if (opts.referralCode) await applyReferralFromBot(created, opts.referralCode);
  if (platform === "telegram" && (await isOwnerTelegramId(externalId))) {
    await setUserAdmin(created.id, true);
    created.isAdmin = true;
  } else {
    const owners = await ownerIds(platform);
    if (owners.has(String(externalId))) {
      await setUserAdmin(created.id, true);
      created.isAdmin = true;
    }
  }

  return { user: created, created: true };
}

async function uniqueReferralCode(base: string): Promise<string> {
  const prefix = (base.replace(/[^a-zA-Z0-9]/g, "").slice(0, 6) || "BOT").toUpperCase();
  const d = await db();
  let code = `${prefix}${Math.floor(1000 + Math.random() * 9000)}`;
  while (d.users.some((u) => u.referralCode === code)) {
    code = `${prefix}${Math.floor(1000 + Math.random() * 9000)}`;
  }
  return code;
}

async function setUserAdmin(userId: string, isAdmin: boolean) {
  await mutate((d) => {
    const u = d.users.find((x) => x.id === userId);
    if (u) u.isAdmin = isAdmin;
  });
}

/** Grant admin to the configured messenger owners (called on every bot start). */
export async function ensureOwnerAdmin(platform: BotPlatform, externalId: string, userId: string) {
  const owners = await ownerIds(platform);
  const isOwner = owners.has(String(externalId)) || (platform === "telegram" && (await isOwnerTelegramId(externalId)));
  if (!isOwner) return false;
  const user = (await db()).users.find((u) => u.id === userId);
  if (user?.isAdmin) return true;
  await setUserAdmin(userId, true);
  return true;
}

/** Credit a referrer when their link installed the bot / registered there. */
export async function applyReferralFromBot(newUser: User, referralCode: string) {
  const code = (referralCode || "").trim().toUpperCase();
  if (!code) return false;
  const d = await db();
  const referrer = d.users.find((u) => u.referralCode.toUpperCase() === code);
  if (!referrer || referrer.id === newUser.id) return false;
  const { grantReferralBonus } = await import("../billing");
  await mutate((dd) => {
    const u = dd.users.find((x) => x.id === newUser.id);
    if (u) u.referredBy = referrer.referralCode;
  });
  await grantReferralBonus(referrer.id, newUser.email, newUser.id);
  return true;
}

/* ------------------------------------------------------------------ */
/* Chat state                                                          */
/* ------------------------------------------------------------------ */

export type ChatPatch = Partial<
  Pick<
    BotChat,
    | "step"
    | "styleId"
    | "pendingPhotoId"
    | "pendingPhotoUrl"
    | "lastGenerationId"
    | "pendingInstruction"
    | "editItemId"
    | "progressMessageId"
    | "locale"
    | "username"
    | "displayName"
    | "userId"
    | "lastError"
    | "extra"
  >
>;

export async function getChat(
  platform: BotPlatform,
  chatId: string,
  identity?: { externalId?: string; username?: string | null; displayName?: string | null; locale?: Locale | null }
): Promise<BotChat> {
  const d = await db();
  const existing = d.botChats.find((c) => c.platform === platform && c.chatId === String(chatId));
  if (existing) {
    const patch: ChatPatch = {};
    if (identity?.username && identity.username !== existing.username) patch.username = identity.username;
    if (identity?.displayName && identity.displayName !== existing.displayName) patch.displayName = identity.displayName;
    if (identity?.locale && identity.locale !== existing.locale) patch.locale = identity.locale;
    if (Object.keys(patch).length) await updateChat(platform, String(chatId), patch);
    return { ...existing, ...(patch as object) } as BotChat;
  }
  const chat: BotChat = {
    id: uid("chat"),
    platform,
    chatId: String(chatId),
    externalId: String(identity?.externalId ?? chatId),
    username: identity?.username ?? null,
    displayName: identity?.displayName ?? null,
    userId: null,
    step: "start",
    styleId: null,
    pendingPhotoId: null,
    pendingPhotoUrl: null,
    lastGenerationId: null,
    pendingInstruction: null,
    editItemId: null,
    progressMessageId: null,
    locale: identity?.locale ?? "ru",
    createdAt: now(),
    updatedAt: now(),
    lastError: null,
    extra: null,
  };
  await mutate((d2) => {
    d2.botChats.push(chat);
  });
  return chat;
}

export async function updateChat(platform: BotPlatform, chatId: string, patch: ChatPatch): Promise<void> {
  await mutate((d) => {
    const chat = d.botChats.find((c) => c.platform === platform && c.chatId === String(chatId));
    if (!chat) return;
    Object.assign(chat, patch, { updatedAt: now() });
  });
}

/** Attach a messenger chat to an account (and remember the identity there). */
export async function linkChatToUser(platform: BotPlatform, chatId: string, userId: string, externalId: string) {
  await mutate((d) => {
    const chat = d.botChats.find((c) => c.platform === platform && c.chatId === String(chatId));
    if (chat) chat.userId = userId;
    const user = d.users.find((u) => u.id === userId);
    if (!user) return;
    const f = USER_FIELD[platform];
    const n = externalIdToNumber(externalId);
    if (f.id === "telegramId") user.telegramId = n ?? user.telegramId;
    if (f.id === "vkId") user.vkId = n ?? user.vkId;
    if (f.id === "maxId") user.maxId = n ?? user.maxId;
  });
}

export async function allChats(): Promise<BotChat[]> {
  return (await db()).botChats;
}

export async function chatCount(): Promise<number> {
  return (await db()).botChats.length;
}

/* ------------------------------------------------------------------ */
/* One-time link tokens (messenger → web / mini app)                   */
/* ------------------------------------------------------------------ */

export async function createLinkToken(
  platform: BotPlatform,
  chatId: string,
  externalId: string,
  userId: string | null
): Promise<{ token: string; expiresAt: number }> {
  const token = uid("lnk").replace(/-/g, "").slice(0, 26);
  const ttl = await linkTtlMs();
  const expiresAt = now() + ttl;
  await mutate((d) => {
    // Keep the store tidy: drop expired/used tokens.
    d.botLinks = d.botLinks.filter((l) => l.expiresAt > now() && !l.usedAt).slice(-500);
    d.botLinks.push({ token, platform, chatId, externalId, userId, createdAt: now(), expiresAt, usedAt: null });
  });
  return { token, expiresAt };
}

/**
 * Bind token: the *website* asks for a deep link, the user opens the bot with it
 * (`t.me/bot?start=bind_…` or a plain `bind_…` message in VK/MAX), and the chat
 * is attached to the existing account instead of creating a new one.
 */
export async function createBindToken(platform: BotPlatform, userId: string): Promise<{ token: string; expiresAt: number }> {
  const token = "bind_" + uid("").replace(/-/g, "").slice(0, 24);
  const ttl = await linkTtlMs();
  const expiresAt = now() + ttl;
  await mutate((d) => {
    d.botLinks = d.botLinks.filter((l) => l.expiresAt > now() && !l.usedAt).slice(-500);
    d.botLinks.push({ token, platform, chatId: "", externalId: "", userId, createdAt: now(), expiresAt, usedAt: null });
  });
  return { token, expiresAt };
}

export type BindResult = { ok: true; userId: string } | { ok: false; error: "not_found" | "expired" | "used" };

export async function consumeBindToken(raw: string): Promise<BindResult> {
  const token = (raw || "").trim();
  if (!token) return { ok: false, error: "not_found" };
  const rec = (await db()).botLinks.find((l) => l.token === token);
  if (!rec) return { ok: false, error: "not_found" };
  if (rec.expiresAt <= now()) return { ok: false, error: "expired" };
  if (rec.usedAt) return { ok: false, error: "used" };
  if (!rec.userId) return { ok: false, error: "not_found" };
  const userId = rec.userId;
  await mutate((d) => {
    const r = d.botLinks.find((l) => l.token === token);
    if (r) r.usedAt = now();
  });
  return { ok: true, userId };
}

export type LinkTokenResult =
  | { ok: true; userId: string | null; platform: BotPlatform; chatId: string; externalId: string }
  | { ok: false; error: "invalid" | "expired" };

/** Single-use: a token that redeems into a web session. */
export async function consumeLinkToken(token: string): Promise<LinkTokenResult> {
  const d = await db();
  const rec = d.botLinks.find((l) => l.token === token);
  if (!rec) return { ok: false, error: "invalid" };
  if (rec.usedAt) return { ok: false, error: "invalid" };
  if (rec.expiresAt < now()) return { ok: false, error: "expired" };
  await mutate((dd) => {
    const r = dd.botLinks.find((l) => l.token === token);
    if (r) r.usedAt = now();
  });
  return {
    ok: true,
    userId: rec.userId,
    platform: rec.platform === "web" ? "telegram" : rec.platform,
    chatId: rec.chatId,
    externalId: rec.externalId,
  };
}

/** Chats that may receive an admin broadcast (owner action, one send each). */
export async function broadcastTargets(platform?: BotPlatform): Promise<BotChat[]> {
  const d = await db();
  return d.botChats.filter((c) => (!platform || c.platform === platform) && c.userId);
}

export async function botStats() {
  const d = await db();
  const byPlatform: Record<string, number> = { telegram: 0, vk: 0, max: 0 };
  let linked = 0;
  for (const c of d.botChats) {
    byPlatform[c.platform] = (byPlatform[c.platform] || 0) + 1;
    if (c.userId) linked++;
  }
  return {
    chats: d.botChats.length,
    linked,
    byPlatform,
    fromBots: d.users.filter((u) => u.origin && u.origin !== "web").length,
    generationsFromBots: d.generations.filter((g) => g.origin && g.origin !== "web").length,
  };
}

/** Locale the user prefers (explicit choice in the bot > account > ru). */
export async function chatLocale(chat: BotChat): Promise<Locale> {
  if (chat.locale) return chat.locale;
  if (chat.userId) {
    const u = (await db()).users.find((x) => x.id === chat.userId);
    if (u?.prefLocale) return u.prefLocale;
  }
  const def = await getSetting("bot_default_locale");
  return def === "en" ? "en" : "ru";
}
