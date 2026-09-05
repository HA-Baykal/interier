import { ensureSeeded } from "./config";
import { ensureAdmin, ensureGalleryExamples } from "./bootstrap";

/**
 * One-time (per server instance) seeding of styles, packages, settings, the
 * admin account and the gallery examples.
 *
 * This lives outside the root layout on purpose: API route handlers do **not**
 * render the layout, so on a cold serverless instance `POST /api/auth/login`
 * could previously run against a completely unseeded database and reject the
 * documented admin credentials. Every auth entry point now awaits the same
 * cached promise, so the admin account is guaranteed to exist before we check
 * a password.
 */
let bootPromise: Promise<void> | null = null;

export function ensureBoot(): Promise<void> {
  if (!bootPromise) {
    bootPromise = (async () => {
      await ensureSeeded();
      await ensureAdmin();
      await ensureGalleryExamples();
    })().catch((e) => {
      // Never cache a failed boot: the next request should retry.
      bootPromise = null;
      throw e;
    });
  }
  return bootPromise;
}

/** Run the boot sequence without letting a failure break the caller. */
export async function ensureBootSafe(): Promise<void> {
  try {
    await ensureBoot();
  } catch (e) {
    console.error("[interier/boot] seeding failed:", e);
  }
}

/**
 * Forget the cached boot result so the next call re-seeds.
 *
 * Needed whenever the underlying store is emptied behind our back (admin reset,
 * a flushed Redis, a recycled ephemeral filesystem): without this the warm
 * instance would keep believing the admin account still exists.
 */
export function invalidateBoot(): void {
  bootPromise = null;
}

/**
 * Guarantee an administrator exists right now.
 *
 * `ensureBoot()` only runs once per instance, so a database that is wiped while
 * the server stays warm would leave the app with no admin at all. Auth entry
 * points call this to repair that case on the spot.
 */
export async function ensureAdminAvailable(): Promise<void> {
  try {
    const { hasAdmin, ensureAdmin } = await import("./bootstrap");
    if (await hasAdmin()) return;
    invalidateBoot();
    await ensureBootSafe();
    if (!(await hasAdmin())) await ensureAdmin();
  } catch (e) {
    console.error("[interier/boot] admin recovery failed:", e);
  }
}
