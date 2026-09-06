import { RequestError, safeErrorMessage } from "../errors";
import type { TelegramConfig } from "./config";

export async function telegramCall<T>(cfg: TelegramConfig, method: "getMe" | "getWebhookInfo" | "setWebhook" | "sendMessage" | "answerCallbackQuery", body: Record<string, unknown> = {}): Promise<T> {
  try {
    const response = await fetch(`https://api.telegram.org/bot${cfg.token}/${method}`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      cache: "no-store", redirect: "error", signal: AbortSignal.timeout(8_000),
    });
    const data = await response.json().catch(() => null);
    if (!response.ok || !data?.ok) {
      const detail = typeof data?.description === "string" ? safeErrorMessage(data.description, [cfg.token, cfg.bypass, cfg.webhookSecret]) : `HTTP ${response.status}`;
      throw new RequestError("telegram_api_failed", `Telegram: ${detail}`, 502);
    }
    return data.result as T;
  } catch (e) {
    if (e instanceof RequestError) throw e;
    throw new RequestError("telegram_unreachable", "Не удалось связаться с Telegram. Повторите позже.", 503);
  }
}
