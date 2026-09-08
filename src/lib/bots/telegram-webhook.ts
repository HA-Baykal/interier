/**
 * Telegram transport of the bot application.
 *
 * The URL is owned by `api/auth/telegram/webhook`: a single webhook carries
 * both the login confirmations and the app updates, so BotFather never has to
 * be re-pointed when the product grows. This module handles everything the
 * login flow did not consume.
 */

import { ensureSeeded, getSettingBool } from "../config";
import { mutateSecurityDocument } from "../security-store";
import { telegramConfig } from "./config";
import { dispatchAndFinish } from "./dispatch";
import { normalizeTelegramUpdate } from "./telegram";
import { tgCall } from "./telegramApi";
import { fulfillStarsPayment } from "../payments-stars";

export async function dispatchTelegramWebhook(req: Request, update: unknown): Promise<void> {
  try {
    // A messenger update must not be the reason an administrator account is
    // created, so the bot path only guarantees the catalogue exists.
    await ensureSeeded();
    if (!update || typeof update !== "object") return;
    const cfg = await telegramConfig();
    if (!cfg.enabled) return;
    // Telegram redelivers an update whenever our answer is late; a retry must
    // not spend the user's credit a second time.
    const updateId = Number((update as { update_id?: unknown }).update_id);
    if (Number.isSafeInteger(updateId) && updateId > 0) {
      const firstTime = await mutateSecurityDocument<boolean, boolean>(`telegram:app:update:${updateId}`, (value) => ({
        value: true,
        expiresAt: Date.now() + 2 * 60 * 60 * 1000,
        result: !value,
      }));
      if (!firstTime) return;
    }
    if (!(await getSettingBool("bots_enabled", true))) return;

    // Telegram Stars payments live on the same webhook. `pre_checkout_query`
    // must be answered within ~10s (we approve), and `successful_payment` is
    // where the package credits are granted (idempotent by our payment id).
    const anyUpdate = update as {
      pre_checkout_query?: { id?: string };
      message?: { successful_payment?: { invoice_payload?: string; telegram_payment_charge_id?: string }; chat?: { id?: number | string } };
    };
    if (anyUpdate.pre_checkout_query?.id) {
      try {
        await tgCall("answerPreCheckoutQuery", { pre_checkout_query_id: anyUpdate.pre_checkout_query.id, ok: true });
      } catch {
        /* approving is best-effort; Telegram retries the query */
      }
      return;
    }
    const paid = anyUpdate.message?.successful_payment;
    if (paid) {
      const res = await fulfillStarsPayment(String(paid.invoice_payload || ""), String(paid.telegram_payment_charge_id || ""));
      const chatId = anyUpdate.message?.chat?.id;
      if (chatId) {
        const text = res.granted
          ? `✅ Оплата прошла! Начислено генераций: ${res.credits}.`
          : "ℹ️ Этот платёж уже учтён.";
        try {
          await tgCall("sendMessage", { chat_id: String(chatId), text });
        } catch {
          /* the credits are already granted; the receipt is cosmetic */
        }
      }
      return;
    }

    // The login transport owns its own callback namespace and start payload; the
    // app must never react to them (a replay would create accounts or answer a
    // confirmation that is somebody else's).
    const bag = update as { callback_query?: { data?: unknown }; message?: { text?: unknown } };
    const action = typeof bag.callback_query?.data === "string" ? bag.callback_query.data : "";
    const text = typeof bag.message?.text === "string" ? bag.message.text : "";
    if (action.startsWith("auth:") || /^\/start(?:@[A-Za-z0-9_]+)?\s+auth_/.test(text)) return;

    const inbound = await normalizeTelegramUpdate(update);
    if (!inbound) return;
    // In groups the bot stays silent unless it is addressed explicitly.
    const isCommand = (inbound.text || "").trim().startsWith("/");
    if (inbound.isGroup && !isCommand) return;

    const host = req.headers.get("x-forwarded-host") || req.headers.get("host");
    await dispatchAndFinish(inbound, host);
  } catch (e) {
    // Never answer 5xx to Telegram: it retries and amplifies any bug we have.
    console.error("[telegram/app]", e instanceof Error ? e.message : e);
  }
}
