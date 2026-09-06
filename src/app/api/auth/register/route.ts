import { NextRequest, NextResponse } from "next/server";
import { assertDurableDatabase } from "@/lib/storage-config";
import { RequestError, safeErrorMessage } from "@/lib/errors";
import { z } from "zod";
import { db, mutate, uid, now } from "@/lib/db";
import { hashPassword, makeSession, setSessionCookie, makeReferralCode, isSecureRequest } from "@/lib/auth";
import { assertSameOrigin } from "@/lib/request-origin";
import { enforceRateLimit, requestClientBucket } from "@/lib/security-store";
import { getSettingNumber } from "@/lib/config";

const schema = z.object({
  name: z.string().min(2).max(60),
  email: z.string().email().max(200),
  password: z.string().min(6).max(128),
  referralCode: z.string().max(40).optional().nullable(),
});

export const maxDuration = 30;

export async function POST(req: NextRequest) {
  try { assertSameOrigin(req); assertDurableDatabase(); await enforceRateLimit("email-register-ip", requestClientBucket(req), 5, 60 * 60_000); return await register(req); }
  catch (e) { return NextResponse.json({ error: e instanceof RequestError ? e.code : "auth_unavailable", message: safeErrorMessage(e) }, { status: e instanceof RequestError ? e.status : 503 }); }
}

async function register(req: NextRequest) {
  const { logAuthDiag } = await import("@/lib/debug");
  await enforceRateLimit("email-register-global", "all", 100, 24 * 60 * 60_000);
  await logAuthDiag(req, "register");
  // Cold API instances never render the layout: make sure defaults are seeded.
  const { ensureBoot } = await import("@/lib/boot");
  await ensureBoot();
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "auth_error_fields" }, { status: 400 });
  }

  const { name, email, password, referralCode } = parsed.data;
  const emailNorm = email.toLowerCase().trim();

  const d = await db();
  if (d.users.some((u) => u.email === emailNorm)) {
    return NextResponse.json({ error: "auth_error_exists" }, { status: 409 });
  }

  // Resolve referral
  let referredBy: string | null = null;
  const rc = referralCode?.trim();
  if (rc) {
    const referrer = d.users.find((u) => u.referralCode.toLowerCase() === rc.toLowerCase());
    if (referrer && referrer.email !== emailNorm) {
      referredBy = referrer.id;
    }
  }

  const userId = uid("usr");
  const freeCredits = await getSettingNumber("free_credits", 0);
  const newReferralCode = await makeReferralCode(emailNorm);

  const passwordHash = hashPassword(password);
  const created = await mutate((draft) => {
    if (draft.users.some((u) => u.email === emailNorm)) return false;
    draft.users.push({
      id: userId,
      email: emailNorm,
      passwordHash,
      name,
      createdAt: now(),
      credits: freeCredits,
      trialUsed: false,
      telegramId: null,
      telegramUsername: null,
      vkId: null,
      vkUsername: null,
      referralCode: draft.users.some((u) => u.referralCode === newReferralCode) ? `${newReferralCode}-${uid().slice(0, 8)}` : newReferralCode,
      referredBy,
      isAdmin: false,
      identityVerifiedAt: null, identityVerifiedBy: null,
    });
    if (referredBy && draft.users.some(user => user.id === referredBy)) {
      draft.referrals.push({ id: uid("ref"), referrerId: referredBy, referredEmail: emailNorm, referredUserId: userId, rewarded: false, createdAt: now() });
    }
    return true;
  });
  if (!created) return NextResponse.json({ error: "auth_error_exists" }, { status: 409 });

  // Referral credit is deferred until a real confirmation flow verifies this account.
  // Merely registering an arbitrary email must not mint spendable credits for a referrer.

  const token = await makeSession(userId);
  setSessionCookie(token, isSecureRequest(req));

  return NextResponse.json({
    ok: true,
    token,
    credits: freeCredits,
    referralApplied: false,
    verificationRequired: true,
  });
}
