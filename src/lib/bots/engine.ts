/**
 * Telegram conversation engine — simplified and focused on the Mini App.
 *
 * Generation is routed directly into the Telegram Mini App ("📱 Открыть приложение").
 * The bot menu provides:
 * 1. "📱 Открыть приложение" (Telegram WebApp button opening /app)
 * 2. "🖼 Мои дизайны" (shows user's generated designs with images & shopping links)
 * 3. "👥 Пригласить друга" (referral link, sharing & stats)
 * 4. "🌐 Язык / Language" (switch RU/EN)
 * 5. "ℹ️ Как это работает" (explains how it works + app button)
 * 6. Admin menu button for admins
 *
 * If a user sends a photo or text commands to the bot chat, they are guided to
 * open the Mini App with the "📱 Открыть приложение" button.
 */

import { db, mutate } from "../db";
import { t as tr } from "../i18n";
import { activePackages, activeStyles, generationMode, getSetting, isUnlimitedMode, setSetting } from "../config";
import { grantTelegramBonus, grantedRewards } from "../billing";
import { categoryById } from "../marketplaces";
import { shoppingSettings } from "../shopping";
import { regenerateShopping } from "../generation/pipeline";
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
  updateChat,
} from "./store";

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
      case "/history":
      case "/designs":
      case "/my":
        return historyFlow(ctx);
      case "/ref":
      case "/referral":
        return { messages: [await referralMessage(ctx)] };
      case "/lang":
      case "/language": {
        const next: Locale = ctx.locale === "ru" ? "en" : "ru";
        return actionFlow(ctx, `${ACTION.LANG}:${next}`);
      }
      case "/credits":
      case "/balance":
        return { messages: [await balanceMessage(ctx)] };
      case "/new":
      case "/design":
      case "/edit":
        return designFlow(ctx);
      case "/admin":
        if (!ctx.isAdmin) return { messages: [{ text: tr(ctx.locale, "bot_not_admin") }, await menu(ctx)] };
        return { messages: [await adminMenuMessage(ctx)] };
      default:
        return { messages: [{ text: tr(ctx.locale, "bot_unsupported") }, await menu(ctx)] };
    }
  }

  // Connecting account: «bind_…» connects this chat to the account from the website.
  if (text.startsWith("bind_")) return bindFlow(ctx, text);

  if (photos.length > 0) return photoFlow(ctx);
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

  return {
    messages: [
      { text: hello },
      await menu(ctx),
    ],
  };
}

async function menu(ctx: Ctx): Promise<BotOutbound> {
  const { locale, isAdmin } = ctx;
  const L = (k: string, v?: Record<string, string | number>) => tr(locale, k, v);
  const rows = [
    [{ kind: "app", text: "📱 " + L("bot_btn_app"), url: ctx.appLink } as BotButton],
    [
      { kind: "callback", text: "🖼 " + L("bot_btn_history"), action: ACTION.HISTORY } as BotButton,
      { kind: "callback", text: "👥 " + L("bot_btn_referral"), action: ACTION.REFERRAL } as BotButton,
    ],
    [
      {
        kind: "callback",
        text: locale === "ru" ? "🌐 English" : "🌐 Русский",
        action: `${ACTION.LANG}:${locale === "ru" ? "en" : "ru"}`,
      } as BotButton,
      { kind: "callback", text: "ℹ️ " + L("bot_btn_help"), action: ACTION.HELP } as BotButton,
    ],
    isAdmin ? [{ kind: "callback", text: "🔧 " + L("bot_btn_admin"), action: ACTION.ADMIN } as BotButton] : null,
  ];
  return { text: L("bot_menu_title"), buttons: clampKeyboard(rows) };
}

async function helpMessage(ctx: Ctx): Promise<BotOutbound> {
  const { locale } = ctx;
  const L = (k: string, v?: Record<string, string | number>) => tr(locale, k, v);
  const styles = await activeStyles();
  return {
    text: [
      `🏠 ${L("app_title")}`,
      "",
      `1. 📸 ${L("how_1")} — ${L("how_1d")}`,
      `2. 🎨 ${L("how_2")} — ${styles.map((s) => s.name[locale] || s.name.ru).join(", ")}`,
      `3. 🛒 ${L("how_3")} — ${L("shop_subtitle")}`,
      "",
      locale === "ru"
        ? "✨ Генерация дизайна происходит прямо в Telegram Mini App. Нажмите кнопку ниже, чтобы начать:"
        : "✨ Design generation takes place right inside our Telegram Mini App. Tap the button below to get started:",
    ]
      .filter(Boolean)
      .join("\n"),
    buttons: clampKeyboard([
      [{ kind: "app", text: "📱 " + L("bot_btn_app"), url: ctx.appLink }],
      [{ kind: "callback", text: "↩️ " + L("common_cancel"), action: ACTION.MENU }],
    ]),
  };
}

function designFlow(ctx: Ctx): BotReply {
  const { locale } = ctx;
  return {
    messages: [
      {
        text: locale === "ru"
          ? "🎨 Создание дизайна интерьера происходит в нашем мини-приложении!\n\nНажмите кнопку ниже, чтобы открыть приложение, загрузить фото комнаты и выбрать понравившийся стиль:"
          : "🎨 Interior design creation happens in our Mini App!\n\nTap the button below to open the app, upload your room photo, and choose your favorite style:",
        buttons: clampKeyboard([
          [{ kind: "app", text: "📱 " + tr(locale, "bot_btn_app"), url: ctx.appLink }],
          [{ kind: "callback", text: "↩️ " + tr(locale, "common_cancel"), action: ACTION.MENU }],
        ]),
      },
    ],
  };
}

function photoFlow(ctx: Ctx): BotReply {
  const { locale } = ctx;
  return {
    messages: [
      {
        text: locale === "ru"
          ? "🎨 Создание дизайна интерьера происходит в нашем мини-приложении!\n\nНажмите кнопку ниже, чтобы открыть приложение, загрузить фото комнаты и выбрать понравившийся стиль:"
          : "🎨 Interior design creation happens in our Mini App!\n\nTap the button below to open the app, upload your room photo, and choose your favorite style:",
        buttons: clampKeyboard([
          [{ kind: "app", text: "📱 " + tr(locale, "bot_btn_app"), url: ctx.appLink }],
          [{ kind: "callback", text: "↩️ " + tr(locale, "common_cancel"), action: ACTION.MENU }],
        ]),
      },
    ],
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

  return {
    messages: [
      {
        text: locale === "ru"
          ? "🎨 Создание дизайна и редактирование интерьера доступны в нашем мини-приложении!\n\nНажмите кнопку ниже, чтобы открыть приложение:"
          : "🎨 Interior design creation and editing happen in our Mini App!\n\nTap the button below to open the app:",
        buttons: clampKeyboard([
          [{ kind: "app", text: "📱 " + tr(locale, "bot_btn_app"), url: ctx.appLink }],
          [{ kind: "callback", text: "↩️ " + tr(locale, "common_cancel"), action: ACTION.MENU }],
        ]),
      },
      await menu(ctx),
    ],
  };
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
    case ACTION.PICK_STYLE:
    case ACTION.GEN_ALL:
      return designFlow(ctx);

    case ACTION.ASK_INSTRUCTION:
    case ACTION.EDIT_ITEM:
      return {
        messages: [
          {
            text: locale === "ru"
              ? "✏️ Редактирование и детализация интерьера доступны в мини-приложении. Нажмите кнопку ниже:"
              : "✏️ Editing and fine-tuning are available in the Mini App. Tap below:",
            buttons: clampKeyboard([
              [{ kind: "app", text: "📱 " + tr(locale, "bot_btn_app"), url: ctx.appLink }],
              [{ kind: "callback", text: "↩️ " + tr(locale, "common_cancel"), action: ACTION.MENU }],
            ]),
          },
        ],
      };

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

    case ACTION.REGEN:
      return designFlow(ctx);

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
      if (arg === "tg") return bonusClaim(ctx, "telegram");
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
      [{ kind: "app", text: "📱 " + tr(locale, "bot_btn_app"), url: ctx.appLink }],
      [{ kind: "callback", text: "🎁 " + tr(locale, "bot_btn_bonus"), action: ACTION.BONUS }],
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
      [{ kind: "callback", text: "↩️ " + tr(locale, "common_cancel"), action: ACTION.MENU }],
    ]),
  };
}

async function bonusMessage(ctx: Ctx): Promise<BotOutbound> {
  const { locale, user } = ctx;
  const [tg, ref] = await Promise.all([getSetting("reward_telegram"), getSetting("reward_referral")]);
  const tgUrl = (await getSetting("channel_telegram_url")) || "https://t.me/interier_ai";
  const granted = user ? (await grantedRewards(user.id)).telegram : false;

  return {
    text: tr(locale, "bot_bonus", { tg: tg || "1", ref: ref || "1" }),
    buttons: clampKeyboard([
      [{ kind: "link", text: `✈️ ${tr(locale, "rewards_telegram")}${granted ? " ✓" : ""}`, url: tgUrl }],
      user && !granted ? [{ kind: "callback", text: `🎁 ${tr(locale, "bot_bonus_claim")} · Telegram`, action: `${ACTION.BONUS}:tg` }] : null,
      [{ kind: "app", text: "📱 " + tr(locale, "bot_btn_app"), url: ctx.appLink }],
      [{ kind: "callback", text: "↩️ " + tr(locale, "common_cancel"), action: ACTION.MENU }],
    ]),
  };
}

async function bonusClaim(ctx: Ctx, channel: "telegram" = "telegram"): Promise<BotReply> {
  const { user, inbound, locale } = ctx;
  if (!user) return { messages: [{ text: tr(locale, "common_error") }] };
  const { verifyChannelMembership } = await import("./telegram");
  const ok = await verifyChannelMembership(inbound.externalId);
  if (ok === false) {
    return {
      messages: [
        {
          text: `✈️ ${tr(locale, "rewards_telegram_desc")}`,
          buttons: clampKeyboard([
            [{ kind: "link", text: tr(locale, "rewards_telegram_url"), url: (await getSetting("channel_telegram_url")) || "https://t.me/interier_ai" }],
            [{ kind: "callback", text: "↩️ " + tr(locale, "common_cancel"), action: ACTION.MENU }],
          ]),
        },
      ],
    };
  }
  const num = Number(inbound.externalId);
  const res = await grantTelegramBonus(user, Number.isFinite(num) ? num : null, inbound.username ?? null);
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
  const d = await db();
  const invitedCount = d.referrals.filter((r) => r.referrerId === user?.id && r.rewarded).length;

  const shareText = encodeURIComponent(
    locale === "ru"
      ? "Создай крутой дизайн интерьера по фото своей комнаты с помощью нейросети!"
      : "Redesign your room interior with AI!"
  );

  return {
    text: [
      `👥 ${locale === "ru" ? "Пригласить друга" : "Invite Friends"}`,
      "",
      tr(locale, "bot_referral", { n: ref || "1", url: botStart }),
      "",
      locale === "ru"
        ? `📊 Приглашено друзей: ${invitedCount}`
        : `📊 Friends invited: ${invitedCount}`,
    ].join("\n"),
    buttons: clampKeyboard([
      [{ kind: "link", text: `🚀 ${locale === "ru" ? "Поделиться ссылкой" : "Share link"}`, url: `https://t.me/share/url?url=${encodeURIComponent(botStart)}&text=${shareText}` }],
      [{ kind: "app", text: "📱 " + tr(locale, "bot_btn_app"), url: ctx.appLink }],
      [{ kind: "callback", text: "↩️ " + tr(locale, "common_cancel"), action: ACTION.MENU }],
    ]),
  };
}

async function historyFlow(ctx: Ctx): Promise<BotReply> {
  const { locale, user } = ctx;
  if (!user) {
    return {
      messages: [
        {
          text: tr(locale, "bot_history_empty"),
          buttons: clampKeyboard([
            [{ kind: "app", text: "📱 " + tr(locale, "bot_btn_app"), url: ctx.appLink }],
            [{ kind: "callback", text: "↩️ " + tr(locale, "common_cancel"), action: ACTION.MENU }],
          ]),
        },
      ],
    };
  }
  const list = (await db())
    .generations.filter((g) => g.userId === user.id)
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, 9);
  if (!list.length) {
    return {
      messages: [
        {
          text: tr(locale, "bot_history_empty"),
          buttons: clampKeyboard([
            [{ kind: "app", text: "📱 " + tr(locale, "bot_btn_app"), url: ctx.appLink }],
            [{ kind: "callback", text: "↩️ " + tr(locale, "common_cancel"), action: ACTION.MENU }],
          ]),
        },
      ],
    };
  }

  const styles = await activeStyles();
  return {
    messages: [
      {
        text: tr(locale, "bot_history_title"),
        buttons: clampKeyboard([
          ...list.map((g) => [
            {
              kind: "callback",
              text: `${g.kind === "edit" ? "✏️" : "🎨"} ${(styles.find((s) => s.id === g.styleId)?.name[locale] || "?").slice(0, 18)} · ${new Date(
                g.createdAt
              ).toLocaleDateString(locale === "ru" ? "ru-RU" : "en-US")}`,
              action: `${ACTION.VIEW_GEN}:${g.id}`,
            } as BotButton,
          ]),
          [{ kind: "app", text: "📱 " + tr(locale, "bot_btn_app"), url: ctx.appLink }],
          [{ kind: "callback", text: "↩️ " + tr(locale, "common_cancel"), action: ACTION.MENU }],
        ]),
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
        buttons: clampKeyboard([
          [{ kind: "app", text: "📱 " + tr(locale, "bot_btn_app"), url: link }],
          [{ kind: "callback", text: "↩️ " + tr(locale, "common_cancel"), action: ACTION.MENU }],
        ]),
      },
    ].filter(Boolean) as BotOutbound[],
  };
}

/* ------------------------------------------------------------------ */
/* Design view and shopping links                                      */
/* ------------------------------------------------------------------ */

async function shoppingMessage(ctx: Ctx, gen: Generation): Promise<BotOutbound> {
  const { locale } = ctx;
  const list = gen.shopping;
  const items = list?.items || [];

  if (!items.length) {
    return {
      text: `${tr(locale, "bot_shopping_title")}\n${tr(locale, "bot_items_none")}`,
      buttons: clampKeyboard([
        [{ kind: "callback", text: "🔄 " + tr(locale, "shop_refresh"), action: `${ACTION.REFRESH_SHOP}:${gen.id}` }],
        [{ kind: "app", text: "📱 " + tr(locale, "bot_btn_app"), url: ctx.appLink }],
        [{ kind: "callback", text: "🖼 " + tr(locale, "bot_btn_history"), action: ACTION.HISTORY }],
      ]),
    };
  }

  const rows: (BotButton | null)[][] = items.slice(0, 8).map((it) => {
    const cat = categoryById(it.category);
    const name = (locale === "ru" ? it.name : it.nameEn || it.name).slice(0, 22);
    const links = it.links.slice(0, 2).map(
      (l) => ({ kind: "link", text: shortMarketplace(l.marketplace), url: l.url } as BotButton)
    );
    return [{ kind: "callback", text: `${cat?.emoji || "🛍️"} ${name}`, action: `${ACTION.VIEW_GEN}:${gen.id}` }, ...links];
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
        { kind: "callback", text: `🔄 ${tr(locale, "shop_refresh")}`, action: `${ACTION.REFRESH_SHOP}:${gen.id}` },
        { kind: "app", text: "📱 " + tr(locale, "bot_btn_app"), url: ctx.appLink },
      ],
      [
        {
          kind: "callback",
          text: gen.published ? `↩️ ${tr(locale, "gallery_unpublish")}` : `📤 ${tr(locale, "gallery_publish")}`,
          action: `${gen.published ? ACTION.UNPUBLISH : ACTION.PUBLISH}:${gen.id}`,
        },
        { kind: "callback", text: "🖼 " + tr(locale, "bot_btn_history"), action: ACTION.HISTORY },
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
      [{ kind: "callback", text: "↩️ " + tr(locale, "common_cancel"), action: ACTION.MENU }],
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
      `${i + 1}. ${(u.name || u.email || "Гость").slice(0, 24)} — ${u.credits}✦${u.isAdmin ? " 👑" : ""}${u.telegramId ? " ✈️" : ""}`
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
