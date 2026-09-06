import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { cleanConnectionValue } from "../env";
import { RequestError } from "../errors";
import { redisDbKey } from "../storage-config";

export function constantTimeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left), b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}
export function digest(value: string): string { return createHash("sha256").update(value).digest("hex"); }
export function telegramScopeHash(): string { return digest(redisDbKey()).slice(0, 24); }

/** Private server configuration. Never send this object to a client or log its URLs. */
export function telegramConfig() {
  const token = cleanConnectionValue(process.env.TELEGRAM_BOT_TOKEN);
  if (!/^\d{5,20}:[A-Za-z0-9_-]{20,120}$/.test(token)) throw new RequestError("telegram_not_configured", "Сохраните корректный TELEGRAM_BOT_TOKEN в окружении этой версии сайта.", 503);
  const username = (cleanConnectionValue(process.env.TELEGRAM_BOT_USERNAME) || "interier_home_bot").replace(/^@/, "");
  if (!/^[A-Za-z0-9_]{5,32}$/.test(username)) throw new RequestError("telegram_config_invalid", "Некорректное имя Telegram-бота.", 503);
  const rawOrigin = cleanConnectionValue(process.env.AUTH_PUBLIC_URL) || cleanConnectionValue(process.env.VERCEL_BRANCH_URL);
  let publicOrigin: string | null = null;
  if (rawOrigin) {
    let parsed: URL;
    try { parsed = new URL(rawOrigin.includes("://") ? rawOrigin : `https://${rawOrigin}`); }
    catch { throw new RequestError("telegram_config_invalid", "AUTH_PUBLIC_URL должен быть постоянным HTTPS-адресом сайта.", 503); }
    if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.search || parsed.hash || !["", "/"].includes(parsed.pathname)) throw new RequestError("telegram_config_invalid", "AUTH_PUBLIC_URL должен быть HTTPS-адресом без пути, пароля и параметров.", 503);
    publicOrigin = parsed.origin;
  }
  const bypass = cleanConnectionValue(process.env.VERCEL_AUTOMATION_BYPASS_SECRET);
  const webhookSecret = createHmac("sha256", token).update(`interier:telegram:webhook:v1:${redisDbKey()}`).digest("hex");
  const webhook = publicOrigin ? new URL("/api/auth/telegram/webhook", publicOrigin) : null;
  if (webhook && bypass) webhook.searchParams.set("x-vercel-protection-bypass", bypass);
  const fingerprint = createHmac("sha256", token).update(`${username.toLowerCase()}:${webhook?.href || ""}:${redisDbKey()}`).digest("hex");
  return { token, username, botId: BigInt(token.split(":")[0]).toString(), publicOrigin, bypass, webhookSecret, webhookUrl: webhook?.href || null, fingerprint };
}
export type TelegramConfig = ReturnType<typeof telegramConfig>;
