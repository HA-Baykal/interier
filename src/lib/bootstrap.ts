import { db, mutate, uid, now } from "./db";
import { hashPassword, makeReferralCode } from "./auth";
import { getSetting, setSetting, activeStyles } from "./config";

/**
 * Seeds a default admin account for the testing phase.
 * Override with ADMIN_EMAIL / ADMIN_PASSWORD env vars in production.
 */
export async function ensureAdmin() {
  if ((await getSetting("boot_admin")) === "1") return;

  const email = (process.env.ADMIN_EMAIL || "admin@interier.ru").toLowerCase().trim();
  const password = process.env.ADMIN_PASSWORD || "admin123";
  const adminReferralCode = await makeReferralCode(email);

  await mutate((d) => {
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
        referralCode: adminReferralCode,
        referredBy: null,
        isAdmin: true,
      });
    }
  });

  await setSetting("boot_admin", "1");
}

/**
 * Seeds a small set of published "example works" so the public gallery is not
 * empty on first launch. Uses each active style's marketing preview image as a
 * showcase design. Idempotent via the boot_gallery setting.
 */
export async function ensureGalleryExamples() {
  if ((await getSetting("boot_gallery")) === "1") return;
  const styles = (await activeStyles()).filter((s) => s.preview);
  if (styles.length > 0) {
    await mutate((d) => {
      for (const s of styles) {
        // Skip if we've already seeded an example for this style.
        if (d.generations.some((g) => g.styleId === s.id && g.originalId === "__example__")) continue;
        d.generations.push({
          id: uid("gen"),
          userId: "__example__",
          styleId: s.id,
          originalId: "__example__",
          originalUrl: s.preview,
          resultUrl: s.preview,
          status: "done",
          error: null,
          mode: "unlimited",
          provider: "Пример",
          createdAt: now(),
          published: true,
        });
      }
    });
  }
  await setSetting("boot_gallery", "1");
}
