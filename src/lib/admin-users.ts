import { db, mutate } from "./db";
import type { DbShape, User, Generation, BotChat, Referral } from "./types";

export type UserOrigin = "web" | "telegram" | "vk" | "max";

export type AdminUserView = {
  id: string;
  email: string | null;
  name: string;
  createdAt: number;
  credits: number;
  trialUsed: boolean;
  isAdmin: boolean;
  origin: UserOrigin;
  prefLocale: string | null;
  telegramId: number | null;
  telegramUsername: string | null;
  telegramLinked: boolean;
  vkId: number | null;
  vkUsername: string | null;
  vkLinked: boolean;
  maxId: number | null;
  maxUsername: string | null;
  maxLinked: boolean;
  referralCode: string;
  referredBy: string | null;
  referralCount: number;
  generationsCount: number;
  lastGenerationAt: number | null;
  generationsByOrigin: {
    web: number;
    telegram: number;
    vk: number;
    max: number;
  };
};

export type AdminUsersStats = {
  total: number;
  web: number;
  telegram: number;
  vk: number;
  max: number;
  admins: number;
  totalCredits: number;
  totalGenerations: number;
};

export function detectUserOrigin(u: User): UserOrigin {
  if (u.origin === "web" || u.origin === "telegram" || u.origin === "vk" || u.origin === "max") {
    return u.origin;
  }
  if (u.telegramId && !u.email) return "telegram";
  if (u.vkId && !u.email) return "vk";
  if (u.maxId && !u.email) return "max";
  return "web";
}

export function buildAdminUsersView(d: DbShape): { stats: AdminUsersStats; users: AdminUserView[] } {
  const chats: BotChat[] = d.botChats || [];
  const gens: Generation[] = d.generations || [];
  const referrals: Referral[] = d.referrals || [];

  const users: AdminUserView[] = (d.users || []).map((u: User) => {
    const origin = detectUserOrigin(u);

    const userGens = gens.filter((g: Generation) => g.userId === u.id || (u.email && g.userId === u.email));
    const generationsCount = userGens.length;
    let lastGenerationAt: number | null = null;
    if (userGens.length > 0) {
      lastGenerationAt = Math.max(...userGens.map((g: Generation) => g.createdAt || 0));
    }

    const generationsByOrigin = {
      web: userGens.filter((g: Generation) => !g.origin || g.origin === "web").length,
      telegram: userGens.filter((g: Generation) => g.origin === "telegram").length,
      vk: userGens.filter((g: Generation) => g.origin === "vk").length,
      max: userGens.filter((g: Generation) => g.origin === "max").length,
    };

    const telegramLinked = !!u.telegramId || chats.some((c: BotChat) => c.platform === "telegram" && c.userId === u.id);
    const vkLinked = !!u.vkId || chats.some((c: BotChat) => c.platform === "vk" && c.userId === u.id);
    const maxLinked = !!u.maxId || chats.some((c: BotChat) => c.platform === "max" && c.userId === u.id);

    const referralCount =
      referrals.filter((r: Referral) => r.referrerId === u.id && r.rewarded).length ||
      d.users.filter((other: User) => other.referredBy === u.referralCode || other.referredBy === u.id).length;

    return {
      id: u.id,
      email: u.email,
      name: u.name || "Пользователь",
      createdAt: u.createdAt,
      credits: u.credits,
      trialUsed: !!u.trialUsed,
      isAdmin: !!u.isAdmin,
      origin,
      prefLocale: u.prefLocale || null,
      telegramId: u.telegramId,
      telegramUsername: u.telegramUsername,
      telegramLinked,
      vkId: u.vkId,
      vkUsername: u.vkUsername,
      vkLinked,
      maxId: u.maxId ?? null,
      maxUsername: u.maxUsername ?? null,
      maxLinked,
      referralCode: u.referralCode,
      referredBy: u.referredBy,
      referralCount,
      generationsCount,
      lastGenerationAt,
      generationsByOrigin,
    };
  });

  // Sort by createdAt desc by default
  users.sort((a, b) => b.createdAt - a.createdAt);

  let webCount = 0;
  let tgCount = 0;
  let vkCount = 0;
  let maxCount = 0;
  let adminCount = 0;
  let totalCredits = 0;

  for (const u of users) {
    if (u.origin === "web") webCount++;
    else if (u.origin === "telegram") tgCount++;
    else if (u.origin === "vk") vkCount++;
    else if (u.origin === "max") maxCount++;
    if (u.isAdmin) adminCount++;
    totalCredits += Math.max(0, u.credits || 0);
  }

  const stats: AdminUsersStats = {
    total: users.length,
    web: webCount,
    telegram: tgCount,
    vk: vkCount,
    max: maxCount,
    admins: adminCount,
    totalCredits,
    totalGenerations: gens.length,
  };

  return { stats, users };
}

export async function getAdminUsersList(): Promise<{ stats: AdminUsersStats; users: AdminUserView[] }> {
  const d = await db();
  return buildAdminUsersView(d);
}

export type AdjustCreditsParams = {
  delta?: number;
  setCredits?: number;
  resetTrial?: boolean;
  setTrialUsed?: boolean;
  setIsAdmin?: boolean;
};

export async function adjustUserCredits(
  targetUserId: string,
  opts: AdjustCreditsParams
): Promise<AdminUserView | null> {
  await mutate((d) => {
    const user = d.users.find((u) => u.id === targetUserId);
    if (!user) return;

    if (typeof opts.setCredits === "number" && !isNaN(opts.setCredits)) {
      user.credits = Math.max(0, Math.floor(opts.setCredits));
    } else if (typeof opts.delta === "number" && !isNaN(opts.delta)) {
      user.credits = Math.max(0, user.credits + Math.floor(opts.delta));
    }

    if (opts.resetTrial === true) {
      user.trialUsed = false;
    } else if (typeof opts.setTrialUsed === "boolean") {
      user.trialUsed = opts.setTrialUsed;
    }

    if (typeof opts.setIsAdmin === "boolean") {
      user.isAdmin = opts.setIsAdmin;
    }
  });

  const updatedDb = await db();
  const list = buildAdminUsersView(updatedDb);
  return list.users.find((u) => u.id === targetUserId) || null;
}
