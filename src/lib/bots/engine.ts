/**
 * Messenger conversation engine — the bot equivalent of the website.
 *
 * One implementation for Telegram, VK and MAX: send a room photo, pick a style,
 * generate, get the design *with a shopping list of its details*, then keep
 * iterating in plain words ("замени только шторы"). Everything is stored on the
 * same accounts the web studio uses, so a chat is just another front-end —
 * including an admin section for the service owner (auto-admin by Telegram id).
 */

import { db, mutate } from "../db";
import { t as tr } from "../i18n";
import { activePackages, activeStyles, generationMode, getSetting, isUnlimitedMode, setSetting } from "../config";
import { grantTelegramBonus } from "../billing";
import { RequestError, safeErrorMessage } from "../errors";
import { resolveImageUrl } from "@/app/api/upload/service";
import { Charge, GenPayload, chargeForGeneration, loadImageBytes, regenerateShopping, runInstructionEdit, runStyleGeneration } from "../generation/pipeline";
import { parseInstruction } from "../generation/instruction";
import { categoryById } from "../marketplaces";
import { shoppingSettings } from "../shopping";
import { now, uid } from "../db";
import { BotChat, Generation, Locale, Style, User } from "../types";
import { ACTION, BotButton, BotInbound, BotOutbound, BotReply, buttons } from "./types";
import { appUrl, publicBaseUrl, telegramConfig } from "./config";
import {
  applyReferralFromBot,
  botStats,
  broadcastTargets,
  createBotUser,
  createLinkToken,
  ensureOwnerAdmin,
  getChat,
  linkChatToUser,
  markIdentityVerified,
  updateChat, } from "./store";

type Ctx = {
  inbound: BotInbound;
  chat: BotChat;
  locale: Locale;
  user: User | null;
  isAdmin: boolean;
  host: string | null;
  appLink: string;
};

const MAX_ROWS = 10;
const MAX_COLS = 3;

function clampKeyboard(rows: (((BotButton | null)[] | null))[]): BotButton[][] {
  return rows
    .map((r) => (r || []).filter(Boolean) as BotButton[])
    .filter((r) => r.length)
    .slice(0, MAX_ROWS)
    .map((r) => r.slice(0, MAX_COLS));
}

/* ------------------------------------------------------------------ */
/* Entry point                                                         */
/* ------------------------------------------------------------------ */

export async function handleBotUpdate(inbound: BotInbound, hostHint?: string | null): Promise<BotReply> {
  const chat = await getChat(inbound.platform, inbound.chatId, {
    externalId: inbound.externalId,
    username: inbound.username ?? null,
    displayName: inbound.displayName ?? null,
    locale: inbound.locale ?? null,
  });

  let user = chat.userId ? (await db()).users.find((u) => u.id === chat.userId) || null : null;
  if (!user) {
    const created = await createBotUser(inbound.platform, inbound.externalId, {
      username: inbound.username ?? null,
      displayName: inbound.displayName ?? null,
      locale: inbound.locale ?? null,
    });
    user = created.user;
    await linkChatToUser(inbound.platform, chat.chatId, user.id, inbound.externalId);
  }
  if (await ensureOwnerAdmin(inbound.platform, inbound.externalId, user.id)) user = { ...user, isAdmin: true };

  const ctx: Ctx = {
    inbound,
    chat,
    locale: (chat.locale as Locale) || "ru",
    user,
    isAdmin: !!user.isAdmin,
    host: hostHint || null,
    appLink: await appUrl(hostHint),
  };

  const text = (inbound.text || "").trim();
  const photos = inbound.photos || [];

  if (text.startsWith("/")) {
    const cmd = text.split(/\s+/)[0].split("@")[0].toLowerCase();
    const arg = text.slice(cmd.length).trim();
    switch (cmd) {
      case "/start":
      case "/menu":
        return startFlow(ctx, arg);
      case "/help":
      case "/about":
        return { messages: [await helpMessage(ctx)] };
      case "/cancel":
        await updateChat(inbound.platform, chat.chatId, {
          step: "start",
          pendingPhotoId: null,
          pendingPhotoUrl: null,
          pendingInstruction: null,
          editItemId: null,
        });
        return { messages: [{ text: tr(ctx.locale, "bot_cancel") }, await menu(ctx)] };
      case "/app":
      case "/web":
      case "/link":
        return linkFlow(ctx);
      case "/credits":
      case "/balance":
        return { messages: [await balanceMessage(ctx)] };
      case "/history":
        return historyFlow(ctx);
      case "/new":
      case "/design":
        return designFlow(ctx);
      // Advertised by setMyCommands: they must not fall through to
      // «не понимаю», otherwise the bot looks half-built in the menu.
      case "/edit":
        return actionFlow(ctx, ACTION.ASK_INSTRUCTION);
      case "/shop":
      case "/items":
        return actionFlow(ctx, ACTION.SHOW_SHOPPING);
      case "/admin":
        if (!ctx.isAdmin) return { messages: [{ text: tr(ctx.locale, "bot_not_admin") }, await menu(ctx)] };
        return { messages: [await adminMenuMessage(ctx)] };
      default:
        return { messages: [{ text: tr(ctx.locale, "bot_unsupported") }, await menu(ctx)] };
    }
  }

  // VK and MAX cannot always carry a deep link, so the code may arrive as a
  // plain message: «bind_…» connects this chat to the account from the website.
  if (text.startsWith("bind_")) return bindFlow(ctx, text);

  if (photos.length > 0) return photoFlow(ctx, photos[0]);
  if (inbound.action) return actionFlow(ctx, inbound.action);
  if (text) return textFlow(ctx, text);

  return { messages: [{ text: tr(ctx.locale, "bot_unsupported") }, await menu(ctx)] };
}

/* ------------------------------------------------------------------ */
/* Menu / static screens                                               */
/* ------------------------------------------------------------------ */

/** `/start [payload]` — greeting, menu, deep-link handling (referrals, app). */
async function startFlow(ctx: Ctx, arg: string): Promise<BotReply> {
  const { locale, inbound, user } = ctx;
  let referral: string | null = null;
  if (arg) {
    if (arg.startsWith("ref_")) referral = arg.slice(4);
    if (arg.startsWith("bind_")) return bindFlow(ctx, arg);
    if (arg.startsWith("app") || arg === "link") return linkFlow(ctx);
  }
  if (referral && user) await applyReferralFromBot(user, referral);

  const name = inbound.displayName || inbound.username || (locale === "ru" ? "друг" : "friend");
  const hello = tr(locale, ctx.isAdmin ? "bot_welcome_owner" : "bot_welcome", { name });
  await updateChat(inbound.platform, ctx.chat.chatId, { step: "start", locale });

  const first = !ctx.chat.lastGenerationId;
  return {
    messages: [
      { text: hello },
      await menu(ctx),
      first
        ? {
            text: tr(locale, "bot_ask_photo"),
            buttons: clampKeyboard([[{ kind: "callback", text: tr(locale, "bot_btn_design"), action: ACTION.START_DESIGN }]]),
          }
        : null,
    ].filter(Boolean) as BotOutbound[],
  };
}

async function menu(ctx: Ctx): Promise<BotOutbound> {
  const { locale, user, isAdmin } = ctx;
  const L = (k: string, v?: Record<string, string | number>) => tr(locale, k, v);
  const rows = [
    [{ kind: "callback", text: L("bot_btn_design"), action: ACTION.START_DESIGN } as BotButton],
    [
      { kind: "callback", text: L("bot_btn_edit"), action: ACTION.ASK_INSTRUCTION } as BotButton,
      { kind: "callback", text: L("bot_btn_history"), action: ACTION.HISTORY } as BotButton,
    ],
    [
      { kind: "callback", text: L("bot_btn_balance", { n: user?.credits ?? 0 }), action: ACTION.BALANCE } as BotButton,
      { kind: "callback", text: L("bot_btn_bonus"), action: ACTION.BONUS } as BotButton,
    ],
    [
      { kind: "callback", text: L("bot_btn_referral"), action: ACTION.REFERRAL } as BotButton,
      {
        kind: "callback",
        text: locale === "ru" ? "🌐 English" : "🌐 Русский",
        action: `${ACTION.LANG}:${locale === "ru" ? "en" : "ru"}`,
      } as BotButton,
    ],
    [{ kind: "callback", text: L("bot_btn_help"), action: ACTION.HELP } as BotButton],
    isAdmin ? [{ kind: "callback", text: L("bot_btn_admin"), action: ACTION.ADMIN } as BotButton] : null,
    [{ kind: "app", text: L("bot_btn_app"), url: ctx.appLink } as BotButton],
  ];
  return { text: L("bot_menu_title"), buttons: clampKeyboard(rows) };
}

async function helpMessage(ctx: Ctx): Promise<BotOutbound> {
  const { locale } = ctx;
  const L = (k: string, v?: Record<string, string | number>) => tr(locale, k, v);
  const styles = await activeStyles();
  const mode = await generationMode();
  return {
    text: [
      L("app_title"),
      "",
      L("hero_subtitle"),
      "",
      `1. ${L("how_1")} — ${L("how_1d")}`,
      `2. ${L("how_2")} — ${styles.map((s) => s.name[locale]).join(", ")}`,
      `3. ${L("how_3")} — ${L("shop_subtitle")}`,
      "",
      `✏️ ${L("edit_hint")}`,
      "",
      "/menu · /history · /credits · /app · /cancel",
      mode === "demo" ? `⚠️ ${L("studio_demo_note")}` : "",
    ]
      .filter(Boolean)
      .join("\n"),
    buttons: clampKeyboard([
      [{ kind: "callback", text: tr(locale, "bot_btn_design"), action: ACTION.START_DESIGN }],
      [{ kind: "app", text: tr(locale, "bot_btn_app"), url: ctx.appLink }],
    ]),
  };
}

function designFlow(ctx: Ctx): BotReply {
  void updateChat(ctx.inbound.platform, ctx.chat.chatId, { step: "await_photo", pendingPhotoId: null, pendingPhotoUrl: null });
  return { messages: [{ text: tr(ctx.locale, "bot_ask_photo") }] };
}

async function photoFlow(ctx: Ctx, photo: { buffer: Buffer; mime: string }): Promise<BotReply> {
  const { inbound, chat } = ctx;
  const { saveUpload } = await import("@/app/api/upload/service");
  const saved = await saveUpload(photo.buffer, photo.mime);
  await updateChat(inbound.platform, chat.chatId, {
    step: "await_style",
    pendingPhotoId: saved.id,
    pendingPhotoUrl: saved.url,
  });
  return { messages: [await stylePicker({ ...ctx, chat: { ...chat, pendingPhotoId: saved.id, pendingPhotoUrl: saved.url, step: "await_style" } })] };
}

async function stylePicker(ctx: Ctx): Promise<BotOutbound> {
  const { locale, chat } = ctx;
  const styles = await activeStyles();
  const rows: (BotButton | null)[][] = [];
  for (let i = 0; i < styles.length; i += 2) {
    const pair = styles.slice(i, i + 2).map(
      (s) => ({ kind: "callback", text: s.name[locale] || s.name.ru, action: `${ACTION.PICK_STYLE}:${s.id}` } as BotButton)
    );
    rows.push(pair);
  }
  rows.push([{ kind: "callback", text: tr(locale, "bot_all_styles"), action: ACTION.GEN_ALL }]);
  if (!chat.pendingInstruction) {
    rows.push([{ kind: "callback", text: "✍️ " + tr(locale, "edit_title"), action: ACTION.ASK_INSTRUCTION }]);
  }
  return {
    text: [
      tr(locale, "bot_choose_style"),
      chat.pendingInstruction ? `✍️ ${chat.pendingInstruction}` : tr(locale, "bot_ask_instruction"),
    ]
      .filter(Boolean)
      .join("\n"),
    buttons: clampKeyboard(rows),
  };
}

/* ------------------------------------------------------------------ */
/* Free text                                                           */
/* ------------------------------------------------------------------ */

async function textFlow(ctx: Ctx, text: string): Promise<BotReply> {
  const { inbound, chat, locale } = ctx;

  if (chat.step === "admin_await_broadcast") {
    await updateChat(inbound.platform, chat.chatId, { step: "start" });
    const task = async (): Promise<BotOutbound[]> => {
      const targets = await broadcastTargets();
      const { deliver } = await import("./deliver");
      let sent = 0;
      for (const c of targets) {
        if (c.chatId === chat.chatId) continue;
        try {
          await deliver(c.platform, c.chatId, [{ text: text.slice(0, 3000) }]);
          sent++;
        } catch {
          /* one unreachable chat must not break the broadcast */
        }
      }
      return [{ text: tr(locale, "bot_admin_broadcast_done", { n: sent }) }];
    };
    return { messages: [{ text: `📣 ${text.slice(0, 200)}` }], task };
  }

  if (chat.step === "await_edit" && chat.lastGenerationId) {
    await updateChat(inbound.platform, chat.chatId, { step: "running", editItemId: null });
    return editFlow(ctx, chat.lastGenerationId, text);
  }

  if (chat.step === "await_instruction") {
    await updateChat(inbound.platform, chat.chatId, { step: "await_style", pendingInstruction: text });
    return { messages: [await stylePicker({ ...ctx, chat: { ...chat, pendingInstruction: text } })] };
  }

  // A finished design exists → free text means "change exactly this".
  if (chat.lastGenerationId && (chat.step === "idle" || chat.step === "start" || chat.step === "await_style")) {
    const parsed = parseInstruction(text);
    if (parsed && parsed.targetCategories.length) {
      return editFlow(ctx, chat.lastGenerationId, text);
    }
    if (chat.pendingPhotoId || chat.step === "await_style") {
      await updateChat(inbound.platform, chat.chatId, { pendingInstruction: text, step: "await_style" });
      return { messages: [await stylePicker({ ...ctx, chat: { ...chat, pendingInstruction: text } })] };
    }
  }

  // Otherwise remember the wish and ask for the photo.
  await updateChat(inbound.platform, chat.chatId, { pendingInstruction: text, step: "await_photo" });
  return { messages: [{ text: `✍️ ${tr(locale, "bot_ask_photo")}` }] };
}

/* ------------------------------------------------------------------ */
/* Buttons                                                             */
/* ------------------------------------------------------------------ */

async function actionFlow(ctx: Ctx, action: string): Promise<BotReply> {
  const { inbound, chat, locale } = ctx;
  const [name, ...rest] = action.split(":");
  const arg = rest.join(":");

  switch (name) {
    case ACTION.MENU:
      return { messages: [await menu(ctx)] };

    case ACTION.START_DESIGN:
      return designFlow(ctx);

    case ACTION.PICK_STYLE: {
      const styles = await activeStyles();
      const style = styles.find((s) => s.id === arg);
      if (!style) return { messages: [{ text: tr(locale, "common_error") }] };
      return generateFlow(ctx, [style], "single");
    }

    case ACTION.GEN_ALL: {
      const styles = await activeStyles();
      if (!styles.length) return { messages: [{ text: tr(locale, "common_error") }] };
      return generateFlow(ctx, styles, "all");
    }

    case ACTION.ASK_INSTRUCTION: {
      if (!chat.lastGenerationId) {
        if (chat.pendingPhotoId) {
          await updateChat(inbound.platform, chat.chatId, { step: "await_instruction" });
          return { messages: [{ text: tr(locale, "bot_ask_instruction") }] };
        }
        return { messages: [{ text: tr(locale, "bot_no_design") }, await menu(ctx)] };
      }
      const gen = (await db()).generations.find((g) => g.id === chat.lastGenerationId);
      const items = gen?.shopping?.items || [];
      await updateChat(inbound.platform, chat.chatId, { step: "await_edit" });
      if (!items.length) return { messages: [{ text: tr(locale, "bot_edit_ask") }] };
      return {
        messages: [
          {
            text: `${tr(locale, "bot_edit_pick")}\n${tr(locale, "bot_edit_ask")}`,
            buttons: clampKeyboard([
              ...items.slice(0, 8).map((i) => [
                {
                  kind: "callback",
                  text: `${categoryById(i.category)?.emoji || "🛍️"} ${(locale === "ru" ? i.name : i.nameEn || i.name).slice(0, 24)}`,
                  action: `${ACTION.EDIT_ITEM}:${i.id}`,
                } as BotButton,
              ]),
              [{ kind: "callback", text: "✍️ " + tr(locale, "bot_btn_edit"), action: `${ACTION.EDIT_ITEM}:free` }],
              [{ kind: "callback", text: tr(locale, "common_cancel"), action: ACTION.MENU }],
            ]),
          },
        ],
      };
    }

    case ACTION.EDIT_ITEM: {
      if (arg === "free") {
        await updateChat(inbound.platform, chat.chatId, { step: "await_edit" });
        return { messages: [{ text: tr(locale, "bot_edit_ask") }] };
      }
      const gen = (await db()).generations.find((g) => g.id === chat.lastGenerationId);
      const item = gen?.shopping?.items.find((i) => i.id === arg);
      if (!gen || !item) return { messages: [{ text: tr(locale, "bot_items_none") }] };
      const wish =
        locale === "ru"
          ? `замени только ${item.name.toLowerCase()} — ${item.query}; остальное не меняй`
          : `replace only the ${item.nameEn || item.name} (${item.queryEn || item.query}), keep everything else unchanged`;
      await updateChat(inbound.platform, chat.chatId, { step: "running", editItemId: item.id });
      return editFlow(ctx, gen.id, wish, [item.category]);
    }

    case ACTION.SHOW_SHOPPING: {
      const gen = await findGeneration(ctx, arg);
      if (!gen) return { messages: [{ text: tr(locale, "bot_no_design") }] };
      return { messages: [await shoppingMessage(ctx, gen)] };
    }

    case ACTION.REFRESH_SHOP: {
      const gen = await findGeneration(ctx, arg);
      if (!gen) return { messages: [{ text: tr(locale, "bot_no_design") }] };
      const task = async (): Promise<BotOutbound[]> => {
        const updated = await regenerateShopping(gen.id);
        await updateChat(inbound.platform, chat.chatId, { lastGenerationId: gen.id, step: "idle" });
        const fresh = (await db()).generations.find((g) => g.id === gen.id);
        if (!fresh || !updated) return [{ text: tr(locale, "shop_refreshed") }];
        return [
          { text: `✅ ${tr(locale, "shop_refreshed")} (${tr(locale, "shop_count", { n: fresh.shopping?.items.length || 0 })})` },
          await shoppingMessage(ctx, fresh),
        ];
      };
      return { messages: [{ text: "🛠 " + tr(locale, "shop_refresh") + "..." }], task };
    }

    case ACTION.VIEW_GEN: {
      const gen = await findGeneration(ctx, arg);
      if (!gen) return { messages: [{ text: tr(locale, "common_error") }] };
      await updateChat(inbound.platform, chat.chatId, { lastGenerationId: gen.id, step: "idle" });
      return { messages: await designMessages(ctx, gen) };
    }

    case ACTION.REGEN: {
      if (!chat.lastGenerationId) return designFlow(ctx);
      const gen = (await db()).generations.find((g) => g.id === chat.lastGenerationId);
      if (!gen) return designFlow(ctx);
      const styles = await activeStyles();
      const style = styles.find((s) => s.id === gen.styleId) || styles[0];
      const src = gen.originalUrl || resolveImageUrl(gen.originalId);
      // Retry always starts from the *original* photo, not from the edit.
      await updateChat(inbound.platform, chat.chatId, { pendingPhotoUrl: src, pendingPhotoId: gen.originalId, step: "await_style" });
      if (!style) return { messages: [{ text: tr(locale, "common_error") }] };
      return generateFlow({ ...ctx, chat: { ...chat, pendingPhotoUrl: src, pendingPhotoId: gen.originalId } }, [style], "single");
    }

    case ACTION.PUBLISH:
    case ACTION.UNPUBLISH: {
      const gen = await findGeneration(ctx, arg);
      if (!gen) return { messages: [{ text: tr(locale, "bot_no_design") }] };
      const published = name === ACTION.PUBLISH;
      await mutate((d) => {
        const g = d.generations.find((x) => x.id === gen.id);
        if (g) g.published = published;
      });
      return {
        messages: [{ text: published ? `✅ ${tr(locale, "gallery_published")}` : `↩️ ${tr(locale, "gallery_private")}` }],
        toast: published ? "✅" : "↩️",
      };
    }

    case ACTION.BALANCE:
      return { messages: [await balanceMessage(ctx)] };

    case ACTION.BONUS:
      if (arg === "tg" || arg === "vk") return bonusClaim(ctx, arg === "tg" ? "telegram" : "vk");
      return { messages: [await bonusMessage(ctx)] };

    case ACTION.REFERRAL:
      return { messages: [await referralMessage(ctx)] };

    case ACTION.HISTORY:
      return historyFlow(ctx);

    case ACTION.OPEN_APP:
      return linkFlow(ctx);

    case ACTION.LANG: {
      const next: Locale = arg === "en" ? "en" : "ru";
      await updateChat(inbound.platform, chat.chatId, { locale: next });
      if (ctx.user) {
        await mutate((d) => {
          const u = d.users.find((x) => x.id === ctx.user!.id);
          if (u) u.prefLocale = next;
        });
      }
      const c2 = { ...ctx, locale: next };
      return { messages: [{ text: next === "en" ? tr("en", "bot_lang_switched") : tr("ru", "bot_lang_switched_ru") }, await menu(c2)] };
    }

    case ACTION.HELP:
      return { messages: [await helpMessage(ctx)] };

    case ACTION.ADMIN:
      if (!ctx.isAdmin) return { messages: [{ text: tr(locale, "bot_not_admin") }, await menu(ctx)] };
      return { messages: [await adminMenuMessage(ctx)] };

    case ACTION.ADMIN_USERS:
      return { messages: [await adminUsers(ctx)] };

    case ACTION.ADMIN_BROADCAST:
      if (!ctx.isAdmin) return { messages: [{ text: tr(locale, "bot_not_admin") }] };
      await updateChat(inbound.platform, chat.chatId, { step: "admin_await_broadcast" });
      return { messages: [{ text: tr(locale, "bot_admin_ask_broadcast") }] };

    case ACTION.ADMIN_MODE_DEMO:
    case ACTION.ADMIN_MODE_AI: {
      if (!ctx.isAdmin) return { messages: [{ text: tr(locale, "bot_not_admin") }] };
      const mode = name === ACTION.ADMIN_MODE_DEMO ? "demo" : "compatible";
      await setSetting("generation_mode", mode);
      return { messages: [{ text: tr(locale, "bot_admin_mode_set", { mode }) }, await adminMenuMessage(ctx)] };
    }

    case ACTION.ADMIN_LIMIT_ON:
    case ACTION.ADMIN_LIMIT_OFF: {
      if (!ctx.isAdmin) return { messages: [{ text: tr(locale, "bot_not_admin") }] };
      const on = name === ACTION.ADMIN_LIMIT_ON ? "1" : "0";
      await setSetting("test_unlimited", on);
      return {
        messages: [{ text: tr(locale, "bot_admin_limit_set", { v: on === "1" ? "ON ♾️" : "OFF" }) }, await adminMenuMessage(ctx)],
      };
    }

    case ACTION.ADMIN_SYNC_WEBHOOK: {
      if (!ctx.isAdmin) return { messages: [{ text: tr(locale, "bot_not_admin") }] };
      const { syncAllWebhooks } = await import("./setup");
      const res = await syncAllWebhooks(ctx.host);
      const list = Object.entries(res)
        .map(([k, v]) => `${k}: ${v.ok ? "✅" : `❌ ${v.error || ""}`}`)
        .join("\n");
      return { messages: [{ text: `${tr(locale, "bot_admin_webhook_done", { list: "" })}\n${list}` }] };
    }

    default:
      return { messages: [await menu(ctx)] };
  }
}

async function findGeneration(ctx: Ctx, id: string | null | undefined): Promise<Generation | null> {
  const genId = id || ctx.chat.lastGenerationId;
  if (!genId) return null;
  const gen = (await db()).generations.find((g) => g.id === genId);
  if (!gen) return null;
  if (ctx.user && gen.userId !== ctx.user.id && !ctx.isAdmin) return null;
  return gen;
}

/* ------------------------------------------------------------------ */
/* Account screens                                                     */
/* ------------------------------------------------------------------ */

async function balanceMessage(ctx: Ctx): Promise<BotOutbound> {
  const { locale, user } = ctx;
  const unlimited = user ? await isUnlimitedMode(user) : false;
  const packs = await activePackages();
  const base = await publicBaseUrl(ctx.host);
  return {
    text: tr(locale, "bot_balance", { n: user?.credits ?? 0, unlimited: unlimited ? "ON ♾️" : "OFF" }),
    buttons: clampKeyboard([
      [{ kind: "callback", text: tr(locale, "bot_btn_bonus"), action: ACTION.BONUS }],
      ...packs.slice(0, 4).map(
        (p) =>
          [
            {
              kind: "link",
              text: `${p.name[locale] || p.name.ru} · ${p.credits}✦ · ${p.price} ₽`,
              url: `${base}/#pricing`,
            } as BotButton,
          ]
      ),
      [{ kind: "app", text: tr(locale, "bot_btn_app"), url: ctx.appLink }],
    ]),
  };
}

async function bonusMessage(ctx: Ctx): Promise<BotOutbound> {
  const { locale, user } = ctx;
  const [tg, vk, ref] = await Promise.all([getSetting("reward_telegram"), getSetting("reward_vk"), getSetting("reward_referral")]);
  const tgUrl = (await getSetting("channel_telegram_url")) || "https://t.me/interier_ai";
  const vkUrl = (await getSetting("channel_vk_url")) || "https://vk.com/interier_ai";
  const { grantedRewards } = await import("../billing");
  const granted = user ? await grantedRewards(user.id) : { telegram: false, vk: false };

  return {
    text: tr(locale, "bot_bonus", { tg: tg || "1", vk: vk || "1", ref: ref || "1" }),
    buttons: clampKeyboard([
      [
        { kind: "link", text: `✈️ ${tr(locale, "rewards_telegram")}${granted.telegram ? " ✓" : ""}`, url: tgUrl },
        { kind: "link", text: `💬 ${tr(locale, "rewards_vk")}${granted.vk ? " ✓" : ""}`, url: vkUrl },
      ],
      user && !granted.telegram ? [{ kind: "callback", text: `🎁 ${tr(locale, "bot_bonus_claim")} · Telegram`, action: `${ACTION.BONUS}:tg` }] : null,
      user && !granted.vk ? [{ kind: "callback", text: `🎁 ${tr(locale, "bot_bonus_claim")} · VK`, action: `${ACTION.BONUS}:vk` }] : null,
      [{ kind: "callback", text: tr(locale, "bot_btn_balance", { n: user?.credits ?? 0 }), action: ACTION.BALANCE }],
    ]),
  };
}

async function bonusClaim(ctx: Ctx, channel: "telegram" | "vk"): Promise<BotReply> {
  const { user, inbound, locale } = ctx;
  if (!user) return { messages: [{ text: tr(locale, "common_error") }] };
  if (channel === "telegram") {
    const { verifyChannelMembership } = await import("./telegram");
    const ok = await verifyChannelMembership(inbound.externalId);
    // null = channel not configured / bot can't check → demo grant (site behaviour parity)
    if (ok === false) {
      return {
        messages: [
          {
            text: `✈️ ${tr(locale, "rewards_telegram_desc")}`,
            buttons: clampKeyboard([[{ kind: "link", text: tr(locale, "rewards_telegram_url"), url: (await getSetting("channel_telegram_url")) || "https://t.me/interier_ai" }]]),
          },
        ],
      };
    }
  }
  const num = Number(inbound.externalId);
  const res = await grantTelegramBonus(user, channel, Number.isFinite(num) ? num : null, inbound.username ?? null);
  const text = res.granted ? tr(locale, "bot_bonus_done", { n: res.credits }) : tr(locale, "bot_bonus_already");
  return { messages: [{ text }, await bonusMessage(ctx)], toast: "🎁" };
}

async function referralMessage(ctx: Ctx): Promise<BotOutbound> {
  const { locale, user } = ctx;
  const ref = await getSetting("reward_referral");
  const code = user?.referralCode || "";
  const base = await publicBaseUrl(ctx.host);
  const url = `${base}/register?ref=${code}`;
  const tg = await telegramConfig();
  const botStart = tg.botUsername ? `https://t.me/${tg.botUsername}?start=ref_${code}` : url;
  return {
    text: tr(locale, "bot_referral", { n: ref || "1", url }),
    buttons: clampKeyboard([
      [{ kind: "link", text: `🔗 ${url.replace(/^https?:\/\//, "")}`, url }],
      tg.botUsername ? [{ kind: "link", text: `✈️ @${tg.botUsername}`, url: botStart }] : null,
    ]),
  };
}

async function historyFlow(ctx: Ctx): Promise<BotReply> {
  const { locale, user } = ctx;
  if (!user) return { messages: [{ text: tr(locale, "bot_no_design") }] };
  const list = (await db())
    .generations.filter((g) => g.userId === user.id)
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, 9);
  if (!list.length) return { messages: [{ text: tr(locale, "bot_history_empty") }, await menu(ctx)] };

  const styles = await activeStyles();
  return {
    messages: [
      {
        text: tr(locale, "bot_history_title"),
        buttons: clampKeyboard(
          list.map((g) => [
            {
              kind: "callback",
              text: `${g.kind === "edit" ? "✏️" : "🎨"} ${(styles.find((s) => s.id === g.styleId)?.name[locale] || "?").slice(0, 18)} · ${new Date(
                g.createdAt
              ).toLocaleDateString(locale === "ru" ? "ru-RU" : "en-US")}`,
              action: `${ACTION.VIEW_GEN}:${g.id}`,
            } as BotButton,
          ])
        ),
      },
    ],
  };
}

/** `bind_<token>` — attach this chat to the account that issued the code. */
async function bindFlow(ctx: Ctx, code: string): Promise<BotReply> {
  const { inbound, locale } = ctx;
  const { consumeBindToken } = await import("./store");
  const res = await consumeBindToken(code);
  if (!res.ok) {
    return {
      messages: [{ text: tr(locale, `bot_bind_${res.error === "not_found" ? "failed" : res.error}`) }, await menu(ctx)],
      toast: tr(locale, "bot_bind_failed"),
    };
  }
  const user = (await db()).users.find((u) => u.id === res.userId) || null;
  if (!user) return { messages: [{ text: tr(locale, "bot_bind_failed") }, await menu(ctx)] };
  await linkChatToUser(inbound.platform, ctx.chat.chatId, user.id, inbound.externalId);
  // «Бот = вход»: after the chat is attached, the account is confirmed by the
  // platform, so it can generate on the site as well.
  await markIdentityVerified(inbound.platform, user.id, inbound.externalId, inbound.username);
  const admin = await ensureOwnerAdmin(inbound.platform, inbound.externalId, user.id);
  const next: Ctx = { ...ctx, user, isAdmin: !!user.isAdmin || admin, chat: { ...ctx.chat, userId: user.id } };
  return {
    messages: [
      { text: tr(locale, "bot_bind_ok", { name: user.name || user.email || "Гость", credits: user.credits }) },
      await menu(next),
    ],
    toast: tr(locale, "bot_bind_ok_short"),
  };
}

async function linkFlow(ctx: Ctx): Promise<BotReply> {
  const { inbound, chat, locale, user } = ctx;
  const { linkTtlMs } = await import("./config");
  const { token } = await createLinkToken(inbound.platform, chat.chatId, inbound.externalId, user?.id ?? null);
  const base = await publicBaseUrl(ctx.host);
  const link = `${base}/app?link=${token}`;
  const min = Math.round((await linkTtlMs()) / 60000);
  return {
    messages: [
      {
        text: tr(locale, "bot_link_hint", { min }),
        buttons: clampKeyboard([[{ kind: "app", text: tr(locale, "bot_btn_app"), url: link }]]),
      },
      user ? { text: tr(locale, "bot_progress_saved") } : null,
    ].filter(Boolean) as BotOutbound[],
  };
}

/* ------------------------------------------------------------------ */
/* Generation + edits                                                  */
/* ------------------------------------------------------------------ */

async function generateFlow(ctx: Ctx, styles: Style[], scope: "single" | "all"): Promise<BotReply> {
  const { inbound, chat, locale, user } = ctx;
  if (!user) return { messages: [{ text: tr(locale, "bot_no_design") }] };
  if (!chat.pendingPhotoId && !chat.pendingPhotoUrl) return designFlow(ctx);

  const src = chat.pendingPhotoUrl || resolveImageUrl(chat.pendingPhotoId!);
  const img = await loadImageBytes(src);
  if (!img) return { messages: [{ text: tr(locale, "common_error") }] };

  // A single style is charged inside the pipeline; a whole set spends the free
  // trial once for all of them, exactly like the website does.
  let charge: Charge | null = null;
  if (scope === "all") {
    try {
      charge = await chargeForGeneration(user, "all");
    } catch (e) {
      return { messages: [{ text: generationErrorMessage(locale, e) }] };
    }
  }

  const instruction = chat.pendingInstruction || null;
  const platform = inbound.platform;
  const chatId = chat.chatId;
  const originalId = chat.pendingPhotoId || uid("up");

  await updateChat(platform, chatId, { step: "running", styleId: styles[0]?.id ?? null });

  const task = async (): Promise<BotOutbound[]> => {
    const out: BotOutbound[] = [];
    let lastGenId: string | null = null;
    for (const style of styles) {
      try {
        const payload = await runStyleGeneration({
          user,
          style,
          source: img,
          originalId,
          originalUrl: src,
          scope,
          preCharged: charge ?? undefined,
          instruction,
          origin: platform,
        });
        lastGenId = payload.id;
        out.push(...(await payloadMessages(ctx, payload)));
      } catch (e) {
        out.push({ text: generationErrorMessage(locale, e) });
      }
    }
    await updateChat(platform, chatId, {
      step: "idle",
      lastGenerationId: lastGenId,
      pendingInstruction: null,
      progressMessageId: null,
    });
    if (!out.length) out.push({ text: tr(locale, "common_error") });
    return out;
  };

  return {
    messages: [
      {
        text: tr(locale, "bot_generating"),
        buttons: clampKeyboard([[{ kind: "callback", text: tr(locale, "common_cancel"), action: ACTION.MENU }]]),
      },
    ],
    toast: tr(locale, "bot_toast_working"),
    task,
  };
}

/** Turns a pipeline failure into something a chat user can act on. */
function generationErrorMessage(locale: Locale, e: unknown): string {
  if (e instanceof RequestError) {
    if (e.code === "no_credits" || e.code === "no_trial" || e.code === "trial_used" || e.code === "free_budget_exhausted") {
      return tr(locale, "bot_no_credits");
    }
    if (e.code === "ai_not_configured") return tr(locale, "bot_ai_not_ready");
    if (e.status < 500 && e.message) return `${tr(locale, "bot_error", { err: e.message })}`;
  }
  return tr(locale, "bot_error", { err: safeErrorMessage(e) });
}

async function editFlow(ctx: Ctx, generationId: string, instruction: string, forceTargets?: string[]): Promise<BotReply> {
  const { inbound, chat, locale, user } = ctx;
  if (!user) return { messages: [{ text: tr(locale, "bot_no_design") }] };

  const parsed = parseInstruction(instruction);
  const targets = forceTargets?.length ? forceTargets : parsed?.targetCategories || [];
  if (!targets.length) {
    await updateChat(inbound.platform, chat.chatId, { step: "await_edit" });
    return { messages: [{ text: `${tr(locale, "edit_none")}\n${tr(locale, "bot_edit_ask")}` }] };
  }

  const platform = inbound.platform;
  const chatId = chat.chatId;

  const task = async (): Promise<BotOutbound[]> => {
    let res: Awaited<ReturnType<typeof runInstructionEdit>>;
    try {
      res = await runInstructionEdit({ user, generationId, instruction, origin: platform });
    } catch (e) {
      return [{ text: generationErrorMessage(locale, e) }];
    }
    await updateChat(platform, chatId, { step: "idle" });
    if ("error" in res) {
      const map: Record<string, string> = {
        not_found: tr(locale, "bot_no_design"),
        not_ready: tr(locale, "bot_error", { err: "design not ready" }),
        no_image: tr(locale, "bot_error", { err: "image unavailable" }),
        forbidden: tr(locale, "common_error"),
        no_styles: tr(locale, "common_error"),
      };
      return [{ text: map[res.error] || tr(locale, "common_error") }];
    }
    await updateChat(platform, chatId, { lastGenerationId: res.payload.id, editItemId: null });
    return await payloadMessages(ctx, res.payload);
  };

  return {
    messages: [
      {
        text: `${tr(locale, "bot_generating")}\n${tr(locale, "edit_targets", {
          list: targets.map((id) => categoryById(id)?.ru || id).join(", "),
        })}`,
      },
    ],
    task,
  };
}

async function payloadMessages(ctx: Ctx, payload: GenPayload): Promise<BotOutbound[]> {
  const { locale } = ctx;
  const base = await publicBaseUrl(ctx.host);
  const absolute = (u: string | null) => (!u ? null : /^https?:/.test(u) ? u : `${base}${u}`);
  const resultUrl = payload.resultUrl || payload.originalUrl;
  const isDemo = !!resultUrl && resultUrl === payload.originalUrl;
  const changed = (payload.changedCategories || []).map((id) => categoryById(id)?.ru || id).join(", ");

  const head =
    payload.kind === "edit"
      ? tr(locale, "bot_done_edit", { list: changed || "—" })
      : tr(locale, "bot_done_design", { style: payload.styleName[locale] || payload.styleName.ru });

  const gen: Generation = {
    id: payload.id,
    userId: ctx.user?.id || "",
    styleId: payload.styleId,
    originalId: "",
    originalUrl: payload.originalUrl,
    resultUrl: payload.resultUrl,
    status: payload.status,
    error: payload.error,
    mode: payload.mode,
    provider: payload.provider,
    createdAt: payload.createdAt,
    published: false,
    shopping: payload.shopping,
    kind: payload.kind,
    instruction: payload.instruction,
    changedCategories: payload.changedCategories,
  };

  const messages: BotOutbound[] = [
    {
      text: [head, isDemo ? `⚠️ ${tr(locale, "studio_demo_note")}` : "", !isDemo && payload.note ? payload.note : ""]
        .filter(Boolean)
        .join("\n"),
      photoUrl: absolute(resultUrl),
    },
    await shoppingMessage(ctx, gen),
  ];
  return messages;
}

async function shoppingMessage(ctx: Ctx, gen: Generation): Promise<BotOutbound> {
  const { locale } = ctx;
  const list = gen.shopping;
  const items = list?.items || [];

  if (!items.length) {
    return {
      text: `${tr(locale, "bot_shopping_title")}\n${tr(locale, "bot_items_none")}`,
      buttons: clampKeyboard([
        [{ kind: "callback", text: "🔄 " + tr(locale, "shop_refresh"), action: `${ACTION.REFRESH_SHOP}:${gen.id}` }],
        [{ kind: "app", text: tr(locale, "bot_btn_app"), url: ctx.appLink }],
      ]),
    };
  }

  const rows: (BotButton | null)[][] = items.slice(0, 8).map((it) => {
    const cat = categoryById(it.category);
    const name = (locale === "ru" ? it.name : it.nameEn || it.name).slice(0, 22);
    const links = it.links.slice(0, 2).map(
      (l) => ({ kind: "link", text: shortMarketplace(l.marketplace), url: l.url } as BotButton)
    );
    return [{ kind: "callback", text: `${cat?.emoji || "🛍️"} ${name}`, action: `${ACTION.EDIT_ITEM}:${it.id}` }, ...links];
  });

  return {
    text: [
      `${tr(locale, "bot_shopping_title")} · ${tr(locale, "shop_count", { n: items.length })}`,
      list?.note ? `ℹ️ ${list.note}` : "",
      tr(locale, "bot_shopping_note"),
    ]
      .filter(Boolean)
      .join("\n"),
    buttons: clampKeyboard([
      ...rows,
      [
        { kind: "callback", text: `✏️ ${tr(locale, "bot_btn_edit")}`, action: ACTION.ASK_INSTRUCTION },
        { kind: "callback", text: `🔄 ${tr(locale, "shop_refresh")}`, action: `${ACTION.REFRESH_SHOP}:${gen.id}` },
      ],
      [
        {
          kind: "callback",
          text: gen.published ? `↩️ ${tr(locale, "gallery_unpublish")}` : `📤 ${tr(locale, "gallery_publish")}`,
          action: `${gen.published ? ACTION.UNPUBLISH : ACTION.PUBLISH}:${gen.id}`,
        },
        { kind: "app", text: tr(locale, "bot_btn_app"), url: ctx.appLink },
      ],
    ]),
  };
}

function shortMarketplace(id: string): string {
  const map: Record<string, string> = {
    ozon: "🛒 Ozon",
    yandex_market: "🟡 Маркет",
    leroy_merlin: "🔧 Лемана",
    wildberries: "🟣 WB",
    hoff: "🛋️ Hoff",
    petrovich: "🧱 Петрович",
  };
  return map[id] || id;
}

async function designMessages(ctx: Ctx, gen: Generation): Promise<BotOutbound[]> {
  const base = await publicBaseUrl(ctx.host);
  const styles = await activeStyles();
  const style = styles.find((s) => s.id === gen.styleId);
  const url = gen.resultUrl ? (/^https?:/.test(gen.resultUrl) ? gen.resultUrl : `${base}${gen.resultUrl}`) : null;
  const when = new Date(gen.createdAt).toLocaleString(ctx.locale === "ru" ? "ru-RU" : "en-US");
  return [
    {
      text: [
        `🎨 ${style ? style.name[ctx.locale] || style.name.ru : ""}`,
        gen.instruction ? `✏️ ${gen.instruction}` : "",
        `🕒 ${when} · ${gen.provider}`,
      ]
        .filter(Boolean)
        .join("\n"),
      photoUrl: url,
    },
    await shoppingMessage(ctx, gen),
  ];
}

/* ------------------------------------------------------------------ */
/* Admin                                                               */
/* ------------------------------------------------------------------ */

async function adminMenuMessage(ctx: Ctx): Promise<BotOutbound> {
  if (!ctx.isAdmin) return { text: tr(ctx.locale, "bot_not_admin") };
  const locale = ctx.locale;
  const mode = await generationMode();
  const unlimited = await isUnlimitedMode();
  return {
    text: `${tr(locale, "bot_admin_title")}\n${await adminStatsText()}`,
    buttons: clampKeyboard([
      [{ kind: "callback", text: tr(locale, "bot_admin_users"), action: ACTION.ADMIN_USERS }],
      [
        {
          kind: "callback",
          text: mode === "demo" ? tr(locale, "bot_admin_mode_ai") : tr(locale, "bot_admin_mode_demo"),
          action: mode === "demo" ? ACTION.ADMIN_MODE_AI : ACTION.ADMIN_MODE_DEMO,
        },
        {
          kind: "callback",
          text: tr(locale, unlimited ? "bot_admin_limit_off" : "bot_admin_limit_on"),
          action: unlimited ? ACTION.ADMIN_LIMIT_OFF : ACTION.ADMIN_LIMIT_ON,
        },
      ],
      [{ kind: "callback", text: tr(locale, "bot_admin_broadcast"), action: ACTION.ADMIN_BROADCAST }],
      [{ kind: "callback", text: tr(locale, "bot_admin_webhook"), action: ACTION.ADMIN_SYNC_WEBHOOK }],
      [{ kind: "app", text: "🖥 " + tr(locale, "admin_title"), url: `${await publicBaseUrl(ctx.host)}/admin` }],
    ]),
  };
}

async function adminStatsText(): Promise<string> {
  const d = await db();
  const s = await botStats();
  return tr("ru", "bot_admin_stats", {
    users: d.users.length,
    bots: s.chats,
    gens: d.generations.length,
    botGens: s.generationsFromBots,
  });
}

async function adminUsers(ctx: Ctx): Promise<BotOutbound> {
  const d = await db();
  const top = [...d.users].sort((a, b) => b.credits - a.credits).slice(0, 8);
  const lines = top.map(
    (u, i) =>
      `${i + 1}. ${(u.name || u.email || "Гость").slice(0, 24)} — ${u.credits}✦${u.isAdmin ? " 👑" : ""}${u.telegramId ? " ✈️" : ""}${u.vkId ? " 💬" : ""}${u.maxId ? " 🔵" : ""}`
  );
  return {
    text: `${tr(ctx.locale, "bot_admin_users")}\n${lines.join("\n") || "—"}`,
    buttons: clampKeyboard([[{ kind: "callback", text: tr(ctx.locale, "bot_btn_admin"), action: ACTION.ADMIN }]]),
  };
}

/** Used by the /start referral deep link when the account was just created. */
export async function attachReferral(userId: string, code: string) {
  const user = (await db()).users.find((u) => u.id === userId);
  if (!user) return false;
  return applyReferralFromBot(user, code);
}
