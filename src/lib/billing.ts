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
  let ok = false;
  await mutate((d) => {
    const u = d.users.find((x) => x.id === userId);
    if (u && u.credits > 0) {
      u.credits -= 1;
      ok = true;
    }
  });
  return ok;
}

/** Detect the subscribing user (Telegram) and grant the one-time bonus. */
export async function grantTelegramBonus(
  user: User,
  channel: "telegram" | "vk",
  externalId: number | null,
  username: string | null
): Promise<{ granted: boolean; already: boolean; credits: number }> {
  const d = await db();
  const existing = d.rewards.find(
    (r) => r.userId === user.id && r.channel === channel
  );
  if (existing?.granted) return { granted: false, already: true, credits: 0 };

  const amount = await rewardAmount(channel === "telegram" ? "reward_telegram" : "reward_vk", 1);

  await mutate((draft) => {
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
  });

  return { granted: true, already: false, credits: amount };
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
  let outcome: ReferralResult = { ok: false };

  await mutate((d) => {
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
export async function referralCount(userId: string): Promise<number> {
  return (await db()).referrals.filter((r) => r.referrerId === userId && r.rewarded).length;
}

/* ------------------------------------------------------------------ */
/* Generation charging (shared by the website and the messenger bots)  */
/* ------------------------------------------------------------------ */

export type ChargeOutcome =
  | { ok: true; consumed: "trial" | "credit" | "unlimited" }
  | { ok: false; error: "no_credits" | "no_trial" };

/**
 * Decide how a generation is paid for and mutate the balance accordingly.
 *
 * `scope: "all"` is the free trial that renders every style at once; while the
 * test "unlimited" switch is on nothing is consumed at all.
 */
export async function authorizeGeneration(
  user: User,
  scope: "single" | "all" = "single"
): Promise<ChargeOutcome> {
  const { isUnlimitedMode } = await import("./config");
  if (await isUnlimitedMode()) return { ok: true, consumed: "unlimited" };

  if (scope === "all") {
    if (user.trialUsed) return { ok: false, error: "no_trial" };
    await mutate((d) => {
      const u = d.users.find((x) => x.id === user.id);
      if (u) u.trialUsed = true;
    });
    return { ok: true, consumed: "trial" };
  }

  if (!user.trialUsed) {
    await mutate((d) => {
      const u = d.users.find((x) => x.id === user.id);
      if (u) u.trialUsed = true;
    });
    return { ok: true, consumed: "trial" };
  }

  const ok = await spendCredit(user.id);
  return ok ? { ok: true, consumed: "credit" } : { ok: false, error: "no_credits" };
}

/** Give a credit back when a generation failed for technical reasons. */
export async function refundGeneration(user: User, consumed: "trial" | "credit" | "unlimited") {
  if (consumed !== "credit") return;
  await addCredits(user.id, 1);
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
