import { createHmac, randomBytes } from "node:crypto";
import { mutate, uid } from "../db";
import { SESSION_TTL_MS, getUserByToken } from "../auth";
import { isIdentityVerified } from "../identity";
import { RequestError } from "../errors";
import { getSecurityDocument, mutateSecurityDocument, enforceRateLimit } from "../security-store";
import type { User } from "../types";
import { constantTimeEqual, digest, telegramConfig, type TelegramConfig } from "./config";
import { telegramConnected } from "./connection";
import { telegramCall } from "./api";

const TTL = 10 * 60_000;
export type TelegramPerson = { id: string; name: string; username: string | null };
type Ticket = {
  id: string; secretHash: string; fingerprint: string; code: string; createdAt: number; expiresAt: number;
  purpose: "login" | "link"; ownerId?: string; referralCode?: string;
  status: "pending" | "waiting" | "approved" | "denied" | "consumed";
  person?: TelegramPerson; claimUntil?: number; processing?: boolean; sessionToken?: string;
};
function key(id: string) {
  if (!/^[a-f0-9]{32}$/.test(id)) throw new RequestError("auth_expired", "Запрос входа недействителен или истёк.", 410);
  return `telegram-ticket:${id}`;
}
function active(ticket: Ticket | null, cfg: TelegramConfig): Ticket {
  if (!ticket || ticket.expiresAt <= Date.now() || !constantTimeEqual(ticket.fingerprint, cfg.fingerprint)) throw new RequestError("auth_expired", "Запрос входа истёк. Начните заново.", 410);
  return ticket;
}
function proof(ticket: Ticket, secret: string) {
  if (!/^[a-f0-9]{64}$/.test(secret) || !constantTimeEqual(ticket.secretHash, digest(secret))) throw new RequestError("auth_expired", "Запрос входа недействителен или истёк.", 410);
}
function cleanName(value: unknown) { return typeof value === "string" ? value.replace(/[\x00-\x1f\x7f]/g, " ").trim().slice(0, 100) : ""; }
function personFrom(value: unknown): TelegramPerson | null {
  if (!value || typeof value !== "object") return null;
  const user = value as Record<string, unknown>;
  if (user.is_bot !== false || !Number.isSafeInteger(user.id) || Number(user.id) <= 0) return null;
  return { id: String(user.id), name: `${cleanName(user.first_name)} ${cleanName(user.last_name)}`.trim() || "Пользователь Telegram", username: cleanName(user.username) || null };
}

export async function startTelegramLogin(input: { purpose: "login" | "link"; owner?: User; clientBucket: string; referralCode?: string }) {
  const cfg = telegramConfig();
  if (!await telegramConnected(cfg)) throw new RequestError("telegram_not_connected", "Администратору нужно сначала подключить бота в настройках сайта.", 503);
  if (input.purpose === "link" && (!input.owner || !isIdentityVerified(input.owner))) throw new RequestError("link_not_allowed", "Привязка доступна уже подтверждённому аккаунту. Для нового аккаунта используйте вход через Telegram.", 403);
  await enforceRateLimit("telegram-start-ip", input.clientBucket, 10, TTL);
  await enforceRateLimit("telegram-start-global", "all", 100, TTL);
  const remote = await telegramCall<{ url?: string }>(cfg, "getWebhookInfo");
  if (remote.url !== cfg.webhookUrl) throw new RequestError("telegram_connection_changed", "Webhook бота изменился. Администратору нужно переподключить его к этой версии сайта.", 503);
  const id = randomBytes(16).toString("hex"), secret = randomBytes(32).toString("hex");
  const now = Date.now();
  const ticket: Ticket = { id, secretHash: digest(secret), fingerprint: cfg.fingerprint, code: id.slice(-6).toUpperCase(), createdAt: now, expiresAt: now + TTL,
    purpose: input.purpose, ownerId: input.purpose === "link" ? input.owner!.id : undefined, referralCode: input.referralCode?.slice(0, 40), status: "pending" };
  await mutateSecurityDocument<Ticket, void>(key(id), current => {
    if (current) throw new RequestError("auth_busy", "Попробуйте начать вход ещё раз.", 503);
    return { value: ticket, expiresAt: ticket.expiresAt, result: undefined };
  });
  // Only this browser receives secret. Telegram sees the random ticket ID/code, never the polling credential.
  return { id, secret, code: ticket.code, expiresAt: ticket.expiresAt, botUrl: `https://t.me/${cfg.username}?start=auth_${id}` };
}

async function updateFromBot(id: string, cfg: TelegramConfig, person: TelegramPerson, action: "start" | "approve" | "deny") {
  return mutateSecurityDocument<Ticket, { code: string; purpose: string; status: Ticket["status"] }>(key(id), current => {
    const ticket = active(current, cfg);
    if (ticket.person && ticket.person.id !== person.id) throw new RequestError("auth_person_mismatch", "Этот запрос уже открыт другим аккаунтом Telegram.", 403);
    if (["denied", "consumed"].includes(ticket.status)) return { value: ticket, expiresAt: ticket.expiresAt, result: { code: ticket.code, purpose: ticket.purpose, status: ticket.status } };
    if (action === "start") {
      if (ticket.status === "pending") { ticket.person = person; ticket.status = "waiting"; }
    } else {
      if (action === "deny" && ticket.status === "approved" && ticket.person) {
        if (ticket.processing) throw new RequestError("auth_finishing", "Вход уже завершается. После него можно выйти на сайте.", 409);
        ticket.status = "denied";
        return { value: ticket, expiresAt: ticket.expiresAt, result: { code: ticket.code, purpose: ticket.purpose, status: ticket.status } };
      }
      if (!ticket.person || ticket.status !== "waiting") {
        if (action === "approve" && ticket.status === "approved") return { value: ticket, expiresAt: ticket.expiresAt, result: { code: ticket.code, purpose: ticket.purpose, status: ticket.status } };
        throw new RequestError("auth_not_started", "Сначала откройте ссылку входа с сайта.", 400);
      }
      ticket.status = action === "approve" ? "approved" : "denied";
    }
    return { value: ticket, expiresAt: ticket.expiresAt, result: { code: ticket.code, purpose: ticket.purpose, status: ticket.status } };
  });
}

/** Called only AFTER validating Telegram's webhook secret, never from posted website identities. */
export async function handleTelegramAuthUpdate(update: unknown): Promise<void> {
  if (!update || typeof update !== "object") return;
  const cfg = telegramConfig();
  const body = update as Record<string, any>;
  const message = body.message;
  if (message?.chat?.type === "private" && typeof message.text === "string") {
    const person = personFrom(message.from);
    if (!person || String(message.chat.id) !== person.id) return;
    const match = message.text.match(/^\/start(?:@[A-Za-z0-9_]+)?\s+auth_([a-f0-9]{32})$/);
    if (!match) {
      if (/^\/start(?:\s|$)/.test(message.text)) await telegramCall(cfg, "sendMessage", { chat_id: person.id, text: "Этот бот подтверждает вход в Interier. Откройте страницу входа на сайте и выберите Telegram. Генерация по сообщениям пока не подключена." });
      return;
    }
    try {
      const state = await updateFromBot(match[1], cfg, person, "start");
      if (state.status !== "waiting") { await telegramCall(cfg, "sendMessage", { chat_id: person.id, text: "Этот запрос уже обработан. Вернитесь на сайт или начните новый вход." }); return; }
      await telegramCall(cfg, "sendMessage", {
        chat_id: person.id,
        text: `${state.purpose === "link" ? "Привязка Telegram к аккаунту" : "Вход"} в Interier.\nКод: ${state.code}\n\nПодтверждайте только если ВЫ САМИ начали это действие на сайте и видите там тот же код. Не подтверждайте вход по чужой ссылке. Это не запуск платной генерации.`,
        reply_markup: { inline_keyboard: [[{ text: "Подтвердить", callback_data: `auth:approve:${match[1]}` }, { text: "Отменить", callback_data: `auth:deny:${match[1]}` }]] },
      });
    } catch (e) {
      if (e instanceof RequestError && e.status < 500) { await telegramCall(cfg, "sendMessage", { chat_id: person.id, text: e.message }); return; }
      throw e;
    }
    return;
  }
  const callback = body.callback_query;
  if (!callback || typeof callback.id !== "string" || typeof callback.data !== "string") return;
  const match = callback.data.match(/^auth:(approve|deny):([a-f0-9]{32})$/);
  const person = personFrom(callback.from);
  if (!match || !person || callback.message?.chat?.type !== "private" || String(callback.message.chat.id) !== person.id || String(callback.message.from?.id) !== cfg.botId) return;
  try {
    const state = await updateFromBot(match[2], cfg, person, match[1] as "approve" | "deny");
    await telegramCall(cfg, "answerCallbackQuery", { callback_query_id: callback.id, text: state.status === "denied" ? "Вход отменён." : state.status === "consumed" ? "Запрос уже обработан. Вернитесь на сайт." : "Подтверждено. Вернитесь на сайт." });
  } catch (e) {
    if (e instanceof RequestError && e.status < 500) { await telegramCall(cfg, "answerCallbackQuery", { callback_query_id: callback.id, text: e.message.slice(0, 180), show_alert: true }); return; }
    throw e;
  }
}

export async function pollTelegramLogin(input: { id: string; secret: string; owner?: User | null; getOwner?: () => Promise<User | null>; cancel?: boolean }) {
  const cfg = telegramConfig();
  const ticket = active(await getSecurityDocument<Ticket>(key(input.id)), cfg);
  proof(ticket, input.secret);
  if (ticket.purpose === "link") {
    const owner = input.owner ?? await input.getOwner?.();
    if (owner?.id !== ticket.ownerId) throw new RequestError("link_session_required", "Вернитесь в аккаунт, в котором начали привязку.", 403);
  }
  await enforceRateLimit("telegram-poll-ticket", input.id, 360, TTL);
  if (ticket.status === "denied") return { status: "denied" as const };
  if (input.cancel && (ticket.status === "consumed" || ticket.processing)) throw new RequestError("auth_finishing", "Вход уже завершается или завершён. При необходимости выйдите из аккаунта на сайте.", 409);
  if (input.cancel) {
    await mutateSecurityDocument<Ticket, void>(key(input.id), current => {
      const value = active(current, cfg); proof(value, input.secret);
      if (value.processing) throw new RequestError("auth_finishing", "Вход уже завершается. После него можно выйти из аккаунта.", 409);
      value.status = "denied";
      return { value, expiresAt: value.expiresAt, result: undefined };
    });
    return { status: "denied" as const };
  }
  if (ticket.status === "consumed") {
    if (ticket.purpose === "link") return { status: "linked" as const };
    if (!ticket.sessionToken || !await getUserByToken(ticket.sessionToken)) throw new RequestError("auth_expired", "Сессия завершена. Начните новый вход.", 410);
    return { status: "authenticated" as const, token: ticket.sessionToken };
  }
  if (ticket.status !== "approved") return { status: "pending" as const };
  const claimed = await mutateSecurityDocument<Ticket, boolean>(key(input.id), current => {
    const value = active(current, cfg); proof(value, input.secret);
    const available = value.status === "approved" && (!value.claimUntil || value.claimUntil <= Date.now());
    if (available) { value.claimUntil = Date.now() + 15_000; value.processing = true; }
    return { value, expiresAt: value.expiresAt, result: available };
  });
  if (!claimed) return { status: "pending" as const };
  const token = `sess_tg_${createHmac("sha256", cfg.token).update(`session:v1:${ticket.fingerprint}:${ticket.id}:${ticket.secretHash}`).digest("hex")}`;
  const candidateId = uid("usr");
  try {
    await mutate(draft => {
      const person = ticket.person!;
      if (!person) throw new RequestError("auth_invalid", "Подтверждение не найдено.", 410);
      const linked = draft.users.find(user => user.verifiedIdentities?.some(identity => identity.provider === "telegram" && identity.subject === person.id));
      let user: User | undefined;
      if (ticket.purpose === "link") {
        user = draft.users.find(user => user.id === ticket.ownerId);
        if (!user || !isIdentityVerified(user)) throw new RequestError("link_not_allowed", "Нужен подтверждённый аккаунт для привязки.", 403);
        if (linked && linked.id !== user.id) throw new RequestError("identity_already_linked", "Этот Telegram уже связан с другим аккаунтом. Войдите через Telegram; автоматического слияния балансов нет.", 409);
        if (user.verifiedIdentities?.some(identity => identity.provider === "telegram" && identity.subject !== person.id)) throw new RequestError("identity_already_linked", "К этому аккаунту уже привязан другой Telegram.", 409);
      } else user = linked;
      if (!user) {
        user = { id: candidateId, email: null, passwordHash: "!", name: person.name, createdAt: Date.now(), credits: 0, trialUsed: false,
          telegramId: null, telegramUsername: null, vkId: null, vkUsername: null, referralCode: `TG${candidateId.replace(/[^a-f0-9]/gi, "").slice(-24).toUpperCase()}`,
          referredBy: null, isAdmin: false };
        draft.users.push(user);
        const referrer = ticket.referralCode ? draft.users.find(candidate => candidate.id !== user!.id && candidate.referralCode.toLowerCase() === ticket.referralCode!.toLowerCase()) : undefined;
        if (referrer) {
          user.referredBy = referrer.id;
          draft.referrals.push({ id: uid("ref"), referrerId: referrer.id, referredEmail: null, referredUserId: user.id, rewarded: false, createdAt: Date.now() });
        }
      }
      user.verifiedIdentities ??= [];
      if (!user.verifiedIdentities.some(identity => identity.provider === "telegram" && identity.subject === person.id)) user.verifiedIdentities.push({ provider: "telegram", subject: person.id, verifiedAt: Date.now() });
      user.telegramId = Number(person.id); user.telegramUsername = person.username;
      user.identityVerifiedAt = Date.now(); user.identityVerifiedBy = "telegram";
      // Never infer identity from an existing unverified email / legacy telegramId, or promote to admin.
      // Signup/referral reward grants remain disabled until their real verification policy is enabled.
      if (ticket.purpose === "login") {
        const existing = draft.sessions.find(session => session.token === token);
        if (existing && existing.userId !== user.id) throw new RequestError("auth_invalid", "Не удалось создать сессию.", 503);
        draft.sessions = draft.sessions.filter(session => session.expiresAt > Date.now());
        if (!existing) draft.sessions.push({ token, userId: user.id, createdAt: Date.now(), expiresAt: Date.now() + SESSION_TTL_MS });
      }
    });
    await mutateSecurityDocument<Ticket, void>(key(input.id), current => {
      const value = active(current, cfg); proof(value, input.secret);
      if (value.status === "denied") throw new RequestError("auth_denied", "Вход отменён.", 410);
      value.status = "consumed"; value.sessionToken = ticket.purpose === "login" ? token : undefined;
      return { value, expiresAt: value.expiresAt, result: undefined };
    });
  } catch (e) {
    try { await mutateSecurityDocument<Ticket, void>(key(input.id), current => {
      const value = active(current, cfg); value.claimUntil = 0;
      if (e instanceof RequestError && e.status < 500) value.status = "denied";
      return { value, expiresAt: value.expiresAt, result: undefined };
    }); } catch { /* TTL/lease permits a safe retry; account/identity/session writes are idempotent. */ }
    throw e;
  }
  return ticket.purpose === "link" ? { status: "linked" as const } : { status: "authenticated" as const, token };
}
