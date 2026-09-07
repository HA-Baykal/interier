import { NextRequest, NextResponse } from "next/server";
import { requireUser, AuthError } from "@/lib/auth";
import { db, mutate, now } from "@/lib/db";
import { makeCode, sendConfirmationCode } from "@/lib/email";
import { grantReferralBonus } from "@/lib/billing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Email confirmation for accounts registered by e-mail.
 *   POST { code }            — confirm the mailed code (marks the user verified)
 *   POST { action:"resend" } — issue a fresh code and e-mail it again
 *
 * Until the code is confirmed the account stays unverified and cannot spend
 * trial/paid generations — that is what stops disposable inboxes from farming
 * free generations.
 */
export async function POST(req: NextRequest) {
  let user;
  try {
    user = await requireUser(req);
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.code }, { status: 401 });
    throw e;
  }
  if (user.identityVerifiedAt) return NextResponse.json({ ok: true, already: true });

  const body = await req.json().catch(() => ({}));
  const isResend = body?.action === "resend";

  if (isResend) {
    const code = makeCode();
    const email = user.email;
    if (!email) return NextResponse.json({ error: "no_email" }, { status: 400 });
    await mutate((d) => {
      const u = d.users.find((x) => x.id === user.id);
      if (u) {
        u.emailConfirmCode = code;
        u.emailConfirmExpires = now() + 30 * 60_000;
      }
    });
    const sent = await sendConfirmationCode(email, code);
    return NextResponse.json({ ok: sent.ok, configured: sent.configured, error: sent.error });
  }

  const code = String(body?.code || "").trim();
  if (!/^\d{6}$/.test(code)) return NextResponse.json({ error: "bad_code" }, { status: 400 });

  const fresh = (await db()).users.find((u) => u.id === user.id);
  if (!fresh || !fresh.emailConfirmCode) return NextResponse.json({ error: "no_code" }, { status: 400 });
  if (fresh.emailConfirmCode !== code) return NextResponse.json({ error: "wrong_code" }, { status: 400 });
  if ((fresh.emailConfirmExpires ?? 0) < now()) return NextResponse.json({ error: "code_expired" }, { status: 400 });

  await mutate((d) => {
    const u = d.users.find((x) => x.id === user.id);
    if (u) {
      u.identityVerifiedAt = now();
      u.identityVerifiedBy = "email";
      u.emailConfirmCode = null;
      u.emailConfirmExpires = null;
    }
  });
  // A confirmed e-mail is a real person: only now does the referrer earn the reward.
  if (fresh.referredBy) {
    await grantReferralBonus(fresh.referredBy, fresh.email ?? "", fresh.id);
  }
  return NextResponse.json({ ok: true });
}
