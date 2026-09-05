import { db, mutate, uid, now } from "./db";
import { hashPassword, verifyPassword, makeReferralCode } from "./auth";
import { getSetting, setSetting, activeStyles } from "./config";

export const DEFAULT_ADMIN_EMAIL = "admin@interier.ru";
export const DEFAULT_ADMIN_PASSWORD = "admin123";

/**
 * Read an env var defensively.
 *
 * Hosting panels (Render/Vercel) and hand-edited .env files routinely leave
 * surrounding quotes, trailing spaces or a stray CR behind. `ADMIN_PASSWORD="admin123"`
 * would otherwise seed the literal password `"admin123"` (with quotes) and the
 * documented credentials would not work.
 */
function envStr(name: string): string | null {
  const raw = process.env[name];
  if (raw === undefined || raw === null) return null;
  let v = String(raw).replace(/\r/g, "").trim();
  if (v.length >= 2 && ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'")))) {
    v = v.slice(1, -1).trim();
  }
  return v.length > 0 ? v : null;
}

export function adminCredentials(): { email: string; password: string; fromEnv: boolean } {
  const email = envStr("ADMIN_EMAIL");
  const password = envStr("ADMIN_PASSWORD");
  return {
    email: (email || DEFAULT_ADMIN_EMAIL).toLowerCase(),
    password: password || DEFAULT_ADMIN_PASSWORD,
    fromEnv: !!email || !!password,
  };
}

/** Stable, non-reversible fingerprint used to detect env credential changes. */
function credentialFingerprint(email: string, password: string): string {
  let h = 5381;
  const s = `${email}\u0000${password}`;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

/**
 * Ensures the admin account exists and matches the configured credentials.
 *
 * Runs on every boot and is self-healing:
 *  - creates the account when it is missing (even if a previous boot flag says
 *    it was already seeded — the account may have been deleted or lost with the
 *    database);
 *  - promotes an existing account with that email to admin;
 *  - re-applies ADMIN_EMAIL / ADMIN_PASSWORD when they change, so updating the
 *    variables in the hosting panel actually takes effect;
 *  - repairs an account whose password hash is unusable.
 *
 * Previously this returned early whenever the `boot_admin` flag was set, so any
 * database that had been seeded once could never get its admin account back —
 * which is why the documented default login stopped working.
 */
export async function ensureAdmin(): Promise<{ email: string; created: boolean; updated: boolean }> {
  const { email, password } = adminCredentials();
  const fingerprint = credentialFingerprint(email, password);
  const storedFingerprint = await getSetting("boot_admin_fp");
  const credentialsChanged = storedFingerprint !== fingerprint;

  const existing = (await db()).users.find((u) => u.email === email);
  const referralCode = existing ? existing.referralCode : await makeReferralCode(email);

  const outcome = await mutate((d) => {
    const user = d.users.find((u) => u.email === email);

    if (!user) {
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
        referralCode,
        referredBy: null,
        isAdmin: true,
      });
      return { created: true, updated: false };
    }

    let updated = false;

    // Always keep admin rights on the configured account.
    if (!user.isAdmin) {
      user.isAdmin = true;
      updated = true;
    }

    // Repair a missing/corrupt hash, and re-apply the configured password when
    // the env credentials changed (so the documented login always works).
    let hashUsable = false;
    try {
      hashUsable = typeof user.passwordHash === "string" && verifyPassword(password, user.passwordHash);
    } catch {
      hashUsable = false;
    }
    const hashLooksValid =
      typeof user.passwordHash === "string" && /^\$2[aby]?\$/.test(user.passwordHash);

    if (!hashLooksValid || (credentialsChanged && !hashUsable)) {
      user.passwordHash = hashPassword(password);
      updated = true;
    }

    if (!user.referralCode) {
      user.referralCode = referralCode;
      updated = true;
    }

    return { created: false, updated };
  });

  if (credentialsChanged) await setSetting("boot_admin_fp", fingerprint);
  // Kept for backwards compatibility with existing databases.
  await setSetting("boot_admin", "1");

  return { email, ...outcome };
}

/** Whether an administrator account currently exists (any user with isAdmin). */
export async function hasAdmin(): Promise<boolean> {
  return (await db()).users.some((u) => u.isAdmin);
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
