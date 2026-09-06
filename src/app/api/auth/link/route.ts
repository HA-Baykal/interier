import { NextRequest, NextResponse } from "next/server";
import { isSecureRequest, makeSession, setSessionCookie } from "@/lib/auth";
import { consumeLinkToken, createBotUser, linkChatToUser } from "@/lib/bots/store";
import { ensureBootSafe } from "@/lib/boot";
import { db } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Redeem the one-time link a bot sent (`/app`) into a web session.
 *
 * This is what makes VK and MAX behave like Telegram's Mini App: the messenger
 * opens our `/app?link=…`, the token is exchanged for a session, and the user
 * lands in an already-authenticated account with the same history and balance.
 */
export async function POST(req: NextRequest) {
  await ensureBootSafe();
  const body = await req.json().catch(() => null);
  const token = typeof body?.token === "string" ? body.token : "";
  if (!token) return NextResponse.json({ error: "bad_request" }, { status: 400 });

  const res = await consumeLinkToken(token);
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: 401 });

  let userId = res.userId;
  if (!userId || !(await db()).users.some((u) => u.id === userId)) {
    const created = await createBotUser(res.platform, res.externalId, { username: null, displayName: null });
    userId = created.user.id;
    if (res.chatId) await linkChatToUser(res.platform, res.chatId, userId, res.externalId);
  }

  const user = (await db()).users.find((u) => u.id === userId)!;
  const session = await makeSession(user.id);
  setSessionCookie(session, isSecureRequest(req));

  return NextResponse.json({
    ok: true,
    token: session,
    platform: res.platform,
    user: { id: user.id, email: user.email, name: user.name, credits: user.credits, isAdmin: user.isAdmin },
  });
}
