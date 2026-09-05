import { NextRequest, NextResponse } from "next/server";
import { getUserFromRequest } from "@/lib/auth";
import { referralCount, grantedRewards } from "@/lib/billing";

export async function GET(req: NextRequest) {
  const user = await getUserFromRequest(req);
  if (!user) {
    return NextResponse.json({ user: null });
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
      vkId: user.vkId,
      telegramGranted: rewards.telegram,
      vkGranted: rewards.vk,
      isAdmin: user.isAdmin,
      referralCount: await referralCount(user.id),
    },
  });
}
