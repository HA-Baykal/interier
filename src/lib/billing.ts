import { db, mutate, uid, now } from "./db";
import { getSettingNumber } from "./config";
import { User, Reward, Referral } from "./types";

/** Number of credits granted per single rewarded action. */
async function rewardAmount(key: string, fallback = 1): Promise<number> {
  return getSettingNumber(key, fallback);
}

/** Add credits to a user (capped to avoid accidental overflow). */
export async function addCredits(userId: string, amount: number) {
  await mutate((d) => {
    const u = d.users.find((x) => x.id === userId);
    if (u) {
      u.credits = Math.max(0, u.credits + amount);
    }
  });
}

export async function spendCredit(userId: string): Promise<boolean> {
  return mutate((d) => {
    const u = d.users.find((x) => x.id === userId);
    if (!u || u.credits <= 0) return false;
    u.credits--;
    return true;
  });
}

/** Detect the subscribing user (Telegram) and grant the one-time bonus. */
export async function grantTelegramBonus(
  user: User,
  channel: "telegram" | "vk",
  externalId: number | null,
  username: string | null
): Promise<{ granted: boolean; already: boolean; credits: number }> {
  const amount = await rewardAmount(channel === "telegram" ? "reward_telegram" : "reward_vk", 1);

  return mutate((draft) => {
    let reward = draft.rewards.find(
      (r) => r.userId === user.id && r.channel === channel
    );
    if (reward?.granted) return { granted: false, already: true, credits: 0 };
    if (!reward) {
      reward = {
        id: uid("rw"),
        userId: user.id,
        channel,
        granted: false,
        createdAt: now(),
        grantedAt: null,
      } as Reward;
      draft.rewards.push(reward);
    }
    reward.granted = true;
    reward.grantedAt = now();

    const u = draft.users.find((x) => x.id === user.id);
    if (u) {
      if (channel === "telegram") {
        u.telegramId = externalId;
        u.telegramUsername = username;
      } else {
        u.vkId = externalId;
        u.vkUsername = username;
      }
      u.credits += amount;
    }
    return { granted: true, already: false, credits: amount };
  });
}

export type ReferralResult = {
  ok: boolean;
  alreadyRewarded?: boolean;
  credits?: number;
};

/** Reward a referrer once per successfully-referenced new user. */
export async function grantReferralBonus(
  referrerUserId: string,
  referredEmail: string,
  referredUserId: string | null
): Promise<ReferralResult> {
  const amount = await rewardAmount("reward_referral", 1);
  return mutate<ReferralResult>((d) => {
    const existing = d.referrals.find((r) => r.referrerId === referrerUserId && r.referredEmail === referredEmail);
    if (existing?.rewarded) return { ok: false, alreadyRewarded: true };
    const user = d.users.find((u) => u.id === referrerUserId);
    if (!user) return { ok: false };
    if (existing) {
      existing.rewarded = true;
      existing.referredUserId = referredUserId;
    } else {
      d.referrals.push({ id: uid("ref"), referrerId: referrerUserId, referredEmail, referredUserId, rewarded: true, createdAt: now() });
    }
    user.credits += amount;
    return { ok: true, credits: amount };
  });
}

/** Count how many friends a user has successfully invited. */
export async function referralCount(userId: string): Promise<number> {
  return (await db()).referrals.filter((r) => r.referrerId === userId && r.rewarded).length;
}

/** Which subscription bonuses have already been granted to a user. */
export async function grantedRewards(userId: string): Promise<{ telegram: boolean; vk: boolean }> {
  const d = await db();
  return {
    telegram: !!d.rewards.find((r) => r.userId === userId && r.channel === "telegram" && r.granted),
    vk: !!d.rewards.find((r) => r.userId === userId && r.channel === "vk" && r.granted),
  };
}

/** Referrals that are still pending (registered but not yet rewarded). */
export async function pendingReferrals(userId: string): Promise<Referral[]> {
  return (await db()).referrals.filter(
    (r) => r.referrerId === userId && !r.rewarded
  );
}
