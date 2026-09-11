import { isIdentityVerified } from "@/lib/identity";
import { NextRequest, NextResponse } from "next/server";
import { getUserFromRequest } from "@/lib/auth";
import { referralCount, grantedRewards } from "@/lib/billing";
import { syncPendingPayments } from "@/lib/yookassa";
import { db } from "@/lib/db";

export async function GET(req: NextRequest) {
  let user = await getUserFromRequest(req);
  if (!user) {
    return NextResponse.json({ user: null });
  }

  // Automatically check and settle any pending YooKassa payments in background
  try {
    await syncPendingPayments(user.id);
    const refreshed = (await db()).users.find((u) => u.id === user!.id);
    if (refreshed) user = refreshed;
  } catch {
    /* ignore sync errors */
  }

  const rewards = await grantedRewards(user.id);
  return NextResponse.json({
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      credits: user.credits,
      trialUsed: user.trialUsed,
      referralCode: user.referralCode,
      referredBy: user.referredBy,
      telegramId: user.telegramId,
      telegramGranted: rewards.telegram,
      isAdmin: user.isAdmin,
      verified: isIdentityVerified(user),
      telegramLinked: !!user.verifiedIdentities?.some(identity => identity.provider === "telegram"),
      referralCount: await referralCount(user.id),
    },
  });
}
