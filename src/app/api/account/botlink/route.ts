import { NextRequest, NextResponse } from "next/server";
import { requireUser, AuthError } from "@/lib/auth";
import { createBindToken } from "@/lib/bots/store";
import { telegramConfig, publicBaseUrl } from "@/lib/bots/config";
import { BotPlatform } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST { platform } — a link that connects the Telegram chat to *this* account.
 */
export async function POST(req: NextRequest) {
  let user;
  try {
    user = await requireUser(req);
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.code }, { status: 401 });
    throw e;
  }

  const platform: BotPlatform = "telegram";
  const { token, expiresAt } = await createBindToken(platform, user.id);
  const host = req.headers.get("x-forwarded-host") || req.headers.get("host");
  const base = await publicBaseUrl(host);

  let chatUrl: string | null = null;
  let usesDeepLink = false;
  const tg = await telegramConfig();
  if (tg.botUsername) {
    chatUrl = `https://t.me/${tg.botUsername}?start=${token}`;
    usesDeepLink = true;
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
