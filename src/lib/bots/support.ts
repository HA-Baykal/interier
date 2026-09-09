/**
 * Support contact shown to users when they run out of generations or when a
 * paid package did not credit the balance ("оплатил, а генерации не пришли").
 *
 * The owner answers manually with the admin panel's "начислить генерации"
 * tool, so the bot must point users straight at a clickable @username that
 * opens the owner's account (https://t.me/<username>).
 */

import { getSetting } from "../config";
import { Locale } from "../types";
import { t } from "../i18n";
import { BotButton, BotOutbound } from "./types";

export const DEFAULT_SUPPORT_USERNAME = "vektor_komforta38";

/** Resolve the support Telegram username (admin setting, sanitized). */
export async function supportContact(): Promise<{ username: string; url: string }> {
  const raw = (await getSetting("support_telegram_username")) || DEFAULT_SUPPORT_USERNAME;
  const username = raw.replace(/^@/, "").trim() || DEFAULT_SUPPORT_USERNAME;
  return { username, url: `https://t.me/${username}` };
}

export function supportButton(label: string, at: string): BotButton {
  return { kind: "link", text: label, url: `https://t.me/${at.replace(/^@/, "")}` };
}

/**
 * Platform-neutral support message with an inline button that opens the
 * owner's account directly. Text keeps `@username` as well, because Telegram
 * linkifies mentions automatically.
 */
export async function creditSupportMessage(
  locale: Locale,
  kind: "no_credits" | "paid" | "help" = "no_credits"
): Promise<BotOutbound> {
  const { username, url } = await supportContact();
  const at = `@${username}`;
  const key = kind === "paid" ? "bot_support_paid" : kind === "help" ? "bot_support_line" : "bot_no_credits_support";
  return {
    text: t(locale, key, { support: at }),
    buttons: [[supportButton(t(locale, "bot_btn_support", { support: at }), at)]],
  };
}
