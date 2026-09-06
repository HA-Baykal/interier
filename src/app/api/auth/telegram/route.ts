import { NextRequest, NextResponse } from "next/server";
import { isSecureRequest, makeSession, setSessionCookie } from "@/lib/auth";
import { telegramConfig } from "@/lib/bots/config";
import { verifyInitDataSync } from "@/lib/bots/telegram";
import { createBotUser } from "@/lib/bots/store";
import { ensureBootSafe } from "@/lib/boot";
import { db } from "@/lib/db";
import { User } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function publicUser(u: User) {
  return { id: u.id, email: u.email, name: u.name, credits: u.credits, isAdmin: u.isAdmin, trialUsed: u.trialUsed };
}

/**
 * Login for the Telegram Mini App.
 *
 * `window.Telegram.WebApp.initData` is verified with the bot token using the
 * official HMAC algorithm, so a real Telegram identity becomes a real Interier
 * session — no passwords inside the messenger. The owner (ADMIN_TELEGRAM_ID) is
 * promoted to administrator here as well.
 */
export async function POST(req: NextRequest) {
  await ensureBootSafe();
  const cfg = await telegramConfig();
  const body = await req.json().catch(() => null);
  const initData = typeof body?.initData === "string" ? body.initData : "";

  if (!cfg.token) {
    return NextResponse.json({ error: "bot_not_configured" }, { status: 503 });
  }

  const verified = verifyInitDataSync(initData, cfg.token, 24 * 3600);
  if (!verified) {
    return NextResponse.json({ error: "invalid_init_data" }, { status: 401 });
  }

  const externalId = String(verified.id);
  let user = (await db()).users.find((u) => u.telegramId !== null && String(u.telegramId) === externalId) || null;
  if (!user) {
    const created = await createBotUser("telegram", externalId, {
      username: verified.username,
      displayName: verified.name,
      locale: verified.locale,
    });
    user = created.user;
  } else if (cfg.adminId && String(cfg.adminId) === externalId && !user.isAdmin) {
    const { mutate } = await import("@/lib/db");
    await mutate((d) => {
      const u = d.users.find((x) => x.id === user!.id);
      if (u) u.isAdmin = true;
    });
    user = { ...user, isAdmin: true };
  }

  const token = await makeSession(user.id);
  setSessionCookie(token, isSecureRequest(req));

  return NextResponse.json({
    ok: true,
    token,
    user: publicUser(user),
    // Sent attachments let the app ask the bot to post the design into the chat.
    canShareToChat: true,
  });
}
