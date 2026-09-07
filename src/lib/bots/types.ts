/**
 * Platform-neutral vocabulary for the messenger bots.
 *
 * Telegram, VK and MAX have very different wire formats, so the engine only ever
 * sees `BotInbound` and only ever produces `BotOutbound`. Adapters translate.
 */

import { BotPlatform, Locale } from "../types";

export type BotPhoto = { buffer: Buffer; mime: string; name?: string };

export type BotInbound = {
  platform: BotPlatform;
  /** Where the reply must go (chat / dialog id, always string). */
  chatId: string;
  /** Messenger user id (numeric in all three platforms, kept as string). */
  externalId: string;
  username?: string | null;
  displayName?: string | null;
  locale?: Locale | null;
  text?: string | null;
  photos?: BotPhoto[];
  /** Callback (button) data. */
  action?: string | null;
  /** Platform id needed to answer/replace the pressed button's message. */
  callbackId?: string | null;
  messageId?: string | null;
  isGroup?: boolean;
  /** Raw update, kept for debugging in the admin panel. */
  raw?: unknown;
};

export type BotButton =
  | { kind: "callback"; text: string; action: string }
  | { kind: "link"; text: string; url: string }
  | { kind: "app"; text: string; url: string }
  | { kind: "reply"; text: string };

export type BotOutbound = {
  text?: string;
  /** Telegram: HTML markup is used for captions. Others strip it. */
  html?: boolean;
  buttons?: BotButton[][];
  /** Public (absolute) URL of an image to attach. */
  photoUrl?: string | null;
  /** Send the photo without its caption (MAX/VK render captions differently). */
  caption?: string;
  /** Replace an earlier message instead of posting a new one. */
  editMessageId?: string | null;
  silent?: boolean;
};

export type BotReply = {
  messages: BotOutbound[];
  /** Short toast for a pressed button (Telegram/VK/MAX support this). */
  toast?: string | null;
  /**
   * Long-running work (a real generation) executed *after* the webhook has been
   * answered, then pushed to the chat. Serverless hosts can disable this via
   * `bots_inline_generation`.
   */
  task?: () => Promise<BotOutbound[]>;
};

export const ACTION = {
  MENU: "menu",
  START_DESIGN: "new",
  PICK_STYLE: "st",
  GEN_ALL: "gen_all",
  SKIP_INSTRUCTION: "skip_desc",
  ASK_INSTRUCTION: "desc",
  SHOW_SHOPPING: "shop",
  TOGGLE_MODE: "mode",
  REFRESH_SHOP: "refresh_shop",
  EDIT_ITEM: "edit_item",
  /** Show where one detail can be bought — never spends a credit. */
  SHOW_ITEM: "show_item",
  /** Explicit confirmation before an edit generation is charged. */
  ASK_REPLACE: "ask_replace",
  REGEN: "regen",
  PUBLISH: "publish",
  UNPUBLISH: "unpub",
  HISTORY: "history",
  VIEW_GEN: "view",
  BALANCE: "balance",
  PROFILE: "profile",
  BONUS: "bonus",
  REFERRAL: "ref",
  OPEN_APP: "open_app",
  LANG: "lang",
  HELP: "help",
  ADMIN: "admin",
  ADMIN_STATS: "admin_stats",
  ADMIN_BROADCAST: "admin_bc",
  ADMIN_USERS: "admin_users",
  ADMIN_MODE_DEMO: "admin_mode_demo",
  ADMIN_MODE_AI: "admin_mode_ai",
  ADMIN_LIMIT_ON: "admin_limit_on",
  ADMIN_LIMIT_OFF: "admin_limit_off",
  ADMIN_SYNC_WEBHOOK: "admin_webhook",
} as const;

export function buttons(rows: (BotButton | null)[][]): BotButton[][] {
  return rows.map((r) => r.filter(Boolean) as BotButton[]).filter((r) => r.length > 0);
}
