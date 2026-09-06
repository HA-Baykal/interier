import type { NextRequest } from "next/server";
import { getSetting } from "../config";
import { RequestError } from "../errors";
import { constantTimeEqual, telegramConfig } from "./config";

/**
 * A Telegram update is authentic when its `X-Telegram-Bot-Api-Secret-Token`
 * matches either the secret derived from the environment token (the login
 * transport) or the secret minted in the admin panel (the bot-application
 * transport). Both are delivered to the same URL on purpose: one bot, one app.
 */
export async function assertTelegramWebhookAuthorized(req: NextRequest): Promise<void> {
  const got = req.headers.get("x-telegram-bot-api-secret-token") || "";
  let derived: string | null = null;
  try {
    derived = telegramConfig().webhookSecret;
  } catch {
    derived = null; // no environment token — the admin-panel secret still authorizes
  }
  const stored = await getSetting("telegram_webhook_secret");
  if ((derived && constantTimeEqual(got, derived)) || (stored && constantTimeEqual(got, stored))) return;
  throw new RequestError("invalid_webhook_secret", "Unauthorized webhook", 401);
}
