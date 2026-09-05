import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db, mutate, uid, now } from "@/lib/db";
import { hashPassword, makeSession, setSessionCookie, makeReferralCode, isSecureRequest } from "@/lib/auth";
import { grantReferralBonus, addCredits } from "@/lib/billing";
import { getSettingNumber } from "@/lib/config";

const schema = z.object({
  name: z.string().min(2).max(60),
  email: z.string().email().max(200),
  password: z.string().min(6).max(128),
  referralCode: z.string().max(40).optional().nullable(),
});

export async function POST(req: NextRequest) {
  const { logAuthDiag } = await import("@/lib/debug");
  logAuthDiag(req, "register");
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "auth_error_fields" }, { status: 400 });
  }

  const { name, email, password, referralCode } = parsed.data;
  const emailNorm = email.toLowerCase().trim();

  const d = db();
  if (d.users.some((u) => u.email === emailNorm)) {
    return NextResponse.json({ error: "auth_error_exists" }, { status: 409 });
  }

  // Resolve referral
  let referredBy: string | null = null;
  let referralOutcome = { ok: false };
  const rc = referralCode?.trim();
  if (rc) {
    const referrer = d.users.find((u) => u.referralCode.toLowerCase() === rc.toLowerCase());
    if (referrer && referrer.email !== emailNorm) {
      referredBy = referrer.id;
    }
  }

  const userId = uid("usr");
  const freeCredits = getSettingNumber("free_credits", 0);

  mutate((draft) => {
    draft.users.push({
      id: userId,
      email: emailNorm,
      passwordHash: hashPassword(password),
      name,
      createdAt: now(),
      credits: freeCredits,
      trialUsed: false,
      telegramId: null,
      telegramUsername: null,
      vkId: null,
      vkUsername: null,
      referralCode: makeReferralCode(emailNorm),
      referredBy,
      isAdmin: false,
    });
  });

  // Grant referral bonus to the referrer if applicable
  if (referredBy) {
    referralOutcome = grantReferralBonus(referredBy, emailNorm, userId);
  }

  const token = makeSession(userId);
  setSessionCookie(token, isSecureRequest(req));

  return NextResponse.json({
    ok: true,
    token,
    credits: freeCredits,
    referralApplied: referralOutcome.ok,
  });
}
