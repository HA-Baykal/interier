import { NextRequest, NextResponse } from "next/server";
import { requireUser, AuthError } from "@/lib/auth";
import { createBindToken } from "@/lib/bots/store";
import { telegramConfig, publicBaseUrl } from "@/lib/bots/config";
import { getSetting } from "@/lib/config";
import { BotPlatform } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST { platform } — a link that connects the messenger chat to *this* account.
 *
 * Without it a user who already writes to the bot ends up with a second, empty
 * profile. The bot redeems `bind_…` on `/start` (Telegram) or as a message (VK,
 * MAX), so the website and the chat become the same account with the same
 * credits and history.
 */
export async function POST(req: NextRequest) {
  let user;
  try {
    user = await requireUser(req);
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.code }, { status: 401 });
    throw e;
  }

  const body = await req.json().catch(() => null);
  const platform = (body?.platform === "vk" || body?.platform === "max" ? body.platform : "telegram") as BotPlatform;
  const { token, expiresAt } = await createBindToken(platform, user.id);
  const host = req.headers.get("x-forwarded-host") || req.headers.get("host");
  const base = await publicBaseUrl(host);

  let chatUrl: string | null = null;
  let usesDeepLink = false;
  if (platform === "telegram") {
    const tg = await telegramConfig();
    if (tg.botUsername) {
      chatUrl = `https://t.me/${tg.botUsername}?start=${token}`;
      usesDeepLink = true;
    }
  } else if (platform === "vk") {
    const groupId = await getSetting("vk_group_id");
    chatUrl = groupId ? `https://vk.com/im?sel=-${groupId}` : null;
  } else {
    const username = await getSetting("max_bot_username");
    chatUrl = username ? `https://max.ru/${username}` : null;
  }

  return NextResponse.json({
    ok: true,
    platform,
    code: token,
    link: chatUrl,
    usesDeepLink,
    appUrl: `${base}/app`,
    expiresAt,
  });
}
