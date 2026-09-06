import { safeErrorMessage } from "../errors";
import { telegramCall } from "./api";
import type { TelegramConfig } from "./config";

export type TelegramBotIdentity = {
  matches: boolean;
  code: "matched" | "username_mismatch" | "id_mismatch" | "unexpected_response" | "check_failed";
  expectedUsername: string;
  actualUsername: string | null;
  botIdMatches: boolean | null;
  usernameMatches: boolean | null;
  message: string;
};

/** Read-only getMe probe. Returns public handles/booleans, never credentials or the raw response. */
export async function inspectTelegramBot(cfg: TelegramConfig): Promise<TelegramBotIdentity> {
  const secrets = [cfg.token, cfg.bypass, cfg.webhookSecret];
  const expectedUsername = safeErrorMessage(cfg.username, secrets);
  const unverified = {
    matches: false, expectedUsername, actualUsername: null, botIdMatches: null, usernameMatches: null,
  };
  let data: unknown;
  try { data = await telegramCall<unknown>(cfg, "getMe"); }
  catch (e) {
    return { ...unverified, code: "check_failed", message: `Проверка Telegram не завершена: ${safeErrorMessage(e, secrets)}` };
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return { ...unverified, code: "unexpected_response", message: "Telegram вернул неожиданный ответ getMe. Бот не проверен; webhook не изменён." };
  }
  const me = data as Record<string, unknown>;
  const username = me.username;
  if (me.is_bot !== true || !Number.isSafeInteger(me.id) || Number(me.id) <= 0
    || typeof username !== "string" || !/^[A-Za-z0-9_]{5,32}$/.test(username)
    || safeErrorMessage(username, secrets) !== username) {
    return { ...unverified, code: "unexpected_response", message: "В ответе getMe нет корректного ID и публичного имени бота. Это не доказательство неверного токена; подключение остановлено." };
  }
  const botIdMatches = String(me.id) === cfg.botId;
  const usernameMatches = username.toLowerCase() === cfg.username.toLowerCase();
  if (!botIdMatches) {
    return { matches: false, code: "id_mismatch", expectedUsername, actualUsername: username, botIdMatches, usernameMatches,
      message: `Telegram сообщил бота @${username}, но его ID не совпал с ID в токене. Подключение остановлено; проверьте целостность сохранённого токена.` };
  }
  if (!usernameMatches) {
    return { matches: false, code: "username_mismatch", expectedUsername, actualUsername: username, botIdMatches, usernameMatches,
      message: `Telegram сообщил бота @${username}, а сайт настроен на @${expectedUsername}. Токен принят, но имя бота другое. Webhook не изменён. Сверьте имя в BotFather; токен в чат не присылайте.` };
  }
  return { matches: true, code: "matched", expectedUsername, actualUsername: username, botIdMatches, usernameMatches,
    message: `Telegram подтвердил бота @${username}. Это только проверка токена; она не подключает и не изменяет webhook.` };
}
