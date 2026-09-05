import { db, mutate, uid, now } from "./db";
import { hashPassword, makeReferralCode } from "./auth";
import { getSetting, setSetting } from "./config";

/**
 * Seeds a default admin account for the testing phase.
 * Override with ADMIN_EMAIL / ADMIN_PASSWORD env vars in production.
 */
export function ensureAdmin() {
  if (getSetting("boot_admin") === "1") return;

  const email = (process.env.ADMIN_EMAIL || "admin@interier.ru").toLowerCase().trim();
  const password = process.env.ADMIN_PASSWORD || "admin123";

  mutate((d) => {
    const existing = d.users.find((u) => u.email === email);
    if (existing) {
      if (!existing.isAdmin) existing.isAdmin = true;
    } else {
      d.users.push({
        id: uid("usr"),
        email,
        passwordHash: hashPassword(password),
        name: "Admin",
        createdAt: now(),
        credits: 999,
        trialUsed: true,
        telegramId: null,
        telegramUsername: null,
        vkId: null,
        vkUsername: null,
        referralCode: makeReferralCode(email),
        referredBy: null,
        isAdmin: true,
      });
    }
  });

  setSetting("boot_admin", "1");
}
