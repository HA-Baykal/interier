import { db, mutate, uid, now } from "./db";
import { getSettingNumber } from "./config";
import { User, Reward, Referral } from "./types";

/** Number of credits granted per single rewarded action. */
function rewardAmount(key: string, fallback = 1): number {
  return getSettingNumber(key, fallback);
}

/** Add credits to a user (capped to avoid accidental overflow). */
export function addCredits(userId: string, amount: number) {
  mutate((d) => {
    const u = d.users.find((x) => x.id === userId);
    if (u) {
      u.credits = Math.max(0, u.credits + amount);
    }
  });
}

export function spendCredit(userId: string): boolean {
  let ok = false;
  mutate((d) => {
    const u = d.users.find((x) => x.id === userId);
    if (u && u.credits > 0) {
      u.credits -= 1;
      ok = true;
    }
  });
  return ok;
}

/** Detect the subscribing user (Telegram) and grant the one-time bonus. */
export function grantTelegramBonus(
  user: User,
  channel: "telegram" | "vk",
  externalId: number | null,
  username: string | null
): { granted: boolean; already: boolean; credits: number } {
  const d = db();
  const existing = d.rewards.find(
    (r) => r.userId === user.id && r.channel === channel
  );
  if (existing?.granted) return { granted: false, already: true, credits: 0 };

  const amount = rewardAmount(channel === "telegram" ? "reward_telegram" : "reward_vk", 1);

  mutate((draft) => {
    let reward = draft.rewards.find(
      (r) => r.userId === user.id && r.channel === channel
    );
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

    if (channel === "telegram") {
      const u = draft.users.find((x) => x.id === user.id);
      if (u) {
        u.telegramId = externalId;
        u.telegramUsername = username;
        u.credits += amount;
      }
    } else {
      const u = draft.users.find((x) => x.id === user.id);
      if (u) {
        u.vkId = externalId;
        u.vkUsername = username;
        u.credits += amount;
      }
    }
  });

  return { granted: true, already: false, credits: amount };
}

export type ReferralResult = {
  ok: boolean;
  alreadyRewarded?: boolean;
  credits?: number;
};

/** Reward a referrer once per successfully-referenced new user. */
export function grantReferralBonus(
  referrerUserId: string,
  referredEmail: string,
  referredUserId: string | null
): ReferralResult {
  const amount = rewardAmount("reward_referral", 1);
  let outcome: ReferralResult = { ok: false };

  mutate((d) => {
    const existing = d.referrals.find(
      (r) => r.referrerId === referrerUserId && r.referredEmail === referredEmail
    );
    if (existing) {
      if (existing.rewarded) outcome = { ok: false, alreadyRewarded: true };
      else {
        existing.rewarded = true;
        existing.referredUserId = referredUserId;
        const u = d.users.find((x) => x.id === referrerUserId);
        if (u) {
          u.credits += amount;
          outcome = { ok: true, credits: amount };
        }
      }
      return;
    }

    d.referrals.push({
      id: uid("ref"),
      referrerId: referrerUserId,
      referredEmail,
      referredUserId,
      rewarded: true,
      createdAt: now(),
    } as Referral);

    const u = d.users.find((x) => x.id === referrerUserId);
    if (u) {
      u.credits += amount;
      outcome = { ok: true, credits: amount };
    }
  });

  return outcome;
}

/** Count how many friends a user has successfully invited. */
export function referralCount(userId: string): number {
  return db().referrals.filter((r) => r.referrerId === userId && r.rewarded).length;
}

/** Which subscription bonuses have already been granted to a user. */
export function grantedRewards(userId: string): { telegram: boolean; vk: boolean } {
  const d = db();
  return {
    telegram: !!d.rewards.find((r) => r.userId === userId && r.channel === "telegram" && r.granted),
    vk: !!d.rewards.find((r) => r.userId === userId && r.channel === "vk" && r.granted),
  };
}

/** Referrals that are still pending (registered but not yet rewarded). */
export function pendingReferrals(userId: string): Referral[] {
  return db().referrals.filter(
    (r) => r.referrerId === userId && !r.rewarded
  );
}
