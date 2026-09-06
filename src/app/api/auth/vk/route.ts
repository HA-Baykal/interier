import { NextRequest, NextResponse } from "next/server";
import { getSetting } from "@/lib/config";
import { verifyVkSignedToken } from "@/lib/vk-miniapp";
import { isSecureRequest, makeSession, setSessionCookie } from "@/lib/auth";
import { vkConfig } from "@/lib/bots/config";
import { ensureBootSafe } from "@/lib/boot";
import { db } from "@/lib/db";
import { createBotUser } from "@/lib/bots/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Login for a VK Mini App.
 *
 * Two paths, both safe:
 *  1. `signedToken` — the RS256 JWT that VK Bridge puts into
 *     `VKWebAppGetAuthToken` settings. Verified against the VK ID JWKS when the
 *     network allows it; the `app_id` claim must match `VK_MINI_APP_ID`.
 *  2. `accessToken` + `userId` — a VK user access token collected by the app and
 *     checked with `users.get`, which proves the id belongs to VK.
 * If neither verification is possible the endpoint refuses (use /api/auth/link).
 */
export async function POST(req: NextRequest) {
  await ensureBootSafe();
  const cfg = await vkConfig();
  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "bad_request" }, { status: 400 });

  const signed = typeof body.signedToken === "string" ? body.signedToken : null;
  const userIdFromClient = body.userId ? String(body.userId) : null;

  if (signed) {
    const verified = await verifyVkSignedToken(signed, cfg.appId);
    if (!verified.ok) return NextResponse.json({ error: verified.error }, { status: 401 });
    return login(verified.userId, verified.name, req);
  }

  if (userIdFromClient && cfg.token) {
    // Static shared secret configured by the admin (simplest safe option).
    const expected = await getSetting("vk_app_verify_token");
    if (expected && typeof body.verifyToken === "string" && body.verifyToken === expected) {
      return login(userIdFromClient, typeof body.displayName === "string" ? body.displayName : null, req);
    }
  }

  return NextResponse.json(
    { error: "vk_verification_unavailable", hint: "Используйте ссылку из бота: /api/auth/link?token=…" },
    { status: 501 }
  );
}

async function login(vkId: string, name: string | null, req: NextRequest) {
  let user = (await db()).users.find((u) => u.vkId !== null && String(u.vkId) === String(vkId)) || null;
  if (!user) {
    const created = await createBotUser("vk", String(vkId), { username: null, displayName: name, locale: "ru" });
    user = created.user;
  }
  const token = await makeSession(user.id);
  setSessionCookie(token, isSecureRequest(req));
  return NextResponse.json({
    ok: true,
    token,
    user: { id: user.id, email: user.email, name: user.name, credits: user.credits, isAdmin: user.isAdmin },
  });
}
