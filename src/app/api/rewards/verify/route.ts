import { NextRequest, NextResponse } from "next/server";
import { requireUser, AuthError } from "@/lib/auth";
import { assertIdentityVerified } from "@/lib/identity";
import { assertSameOrigin } from "@/lib/request-origin";
import { RequestError, safeErrorMessage } from "@/lib/errors";
import { grantTelegramBonus } from "@/lib/billing";

/**
 * Claim the "+1 за подписку" bonus from the website / Mini App.
 *
 * Fail closed: a bonus is granted ONLY after a real platform membership check
 * (`getChatMember` for Telegram, `groups.isMember` for VK). The check always
 * runs against the platform identity that is already bound to the account
 * server-side (user.telegramId / user.vkId) — a client-sent id or username is
 * never proof of subscribing, so nobody can claim a bonus they did not earn.
 */
export async function POST(req: NextRequest) {
  try {
    assertSameOrigin(req);
    const user = await requireUser(req);
    assertIdentityVerified(user);

    const body = await req.json().catch(() => ({}));
    const channel: string = String((body as any)?.channel || "").toLowerCase();
    if (channel !== "telegram" && channel !== "vk") {
      return NextResponse.json({ error: "bad_channel" }, { status: 400 });
    }

    const boundId = channel === "telegram" ? user.telegramId : user.vkId;
    if (!boundId) {
      return NextResponse.json(
        {
          error: "platform_not_linked",
          message:
            "К аккаунту не привязан профиль этой платформы. Привяжите его в кабинете или заберите бонус в боте (меню «🎁 Бонусы») — там подписка проверяется автоматически.",
        },
        { status: 400 }
      );
    }

    let membership: boolean | null;
    if (channel === "telegram") {
      const { verifyChannelMembership } = await import("@/lib/bots/telegram");
      membership = await verifyChannelMembership(String(boundId));
    } else {
      const { vkIsMember } = await import("@/lib/bots/vk");
      membership = await vkIsMember(String(boundId));
    }

    if (membership !== true) {
      const status = membership === null ? 503 : 400;
      const message =
        membership === null
          ? "Не удалось проверить подписку: канал/сообщество не настроены, либо у бота нет прав администратора (для проверки он должен быть админом канала)."
          : "Вы ещё не подписаны на канал/сообщество. Сначала подпишитесь и попробуйте снова — без проверки бонус не начисляется.";
      const { getSetting } = await import("@/lib/config");
      const channelUrl =
        (await getSetting(channel === "telegram" ? "channel_telegram_url" : "channel_vk_url")) ||
        (channel === "telegram" ? "https://t.me/interier_ai" : "https://vk.com/interier_ai");
      return NextResponse.json(
        {
          error: membership === null ? "verification_unavailable" : "not_subscribed",
          message,
          ...(membership === null ? {} : { channelUrl }),
        },
        { status }
      );
    }

    const res = await grantTelegramBonus(
      user,
      channel as "telegram" | "vk",
      boundId,
      channel === "telegram" ? user.telegramUsername : user.vkUsername
    );
    if (!res.granted) {
      return NextResponse.json({ error: "already_granted", granted: false, credits: 0 }, { status: 200 });
    }
    return NextResponse.json({ ok: true, granted: true, credits: res.credits });
  } catch (e) {
    return NextResponse.json({ error: e instanceof AuthError ? e.code : e instanceof RequestError ? e.code : "reward_unavailable", message: e instanceof AuthError ? "Войдите в аккаунт." : safeErrorMessage(e) },
      { status: e instanceof AuthError ? 401 : e instanceof RequestError ? e.status : 503 });
  }
}
