import { NextRequest, NextResponse } from "next/server";
import { db, storageMode } from "@/lib/db";
import { adminCredentials, ensureAdmin } from "@/lib/bootstrap";
import { getUserFromRequest } from "@/lib/auth";
import { ensureBoot } from "@/lib/boot";
import { storageStatus } from "@/lib/storage-diagnostics";
import { assertDurableDatabase } from "@/lib/storage-config";
import { safeErrorMessage } from "@/lib/errors";
import { cleanConfigValue } from "@/lib/env";

/**
 * Admin bootstrap diagnostics & recovery.
 *
 * GET  — reports whether an admin account exists and which storage backend is
 *        active. Never returns passwords or hashes, so it is safe to open in a
 *        browser when "the default admin login does not work".
 *
 * POST — re-applies the configured admin account (ADMIN_EMAIL / ADMIN_PASSWORD,
 *        defaults `admin@interier.ru` / `admin123`). Allowed when:
 *          * no admin account exists yet (self-healing after data loss), or
 *          * the caller is already signed in as an admin, or
 *          * the request carries the correct `ADMIN_SETUP_TOKEN`
 *            (`?token=` or the `x-setup-token` header).
 *        This prevents anybody from resetting a *changed* admin password.
 */

export const dynamic = "force-dynamic";
export const maxDuration = 30;
const noStore = { "Cache-Control": "private, no-store" };

function setupToken(): string | null {
  const raw = process.env.ADMIN_SETUP_TOKEN;
  if (!raw) return null;
  const v = cleanConfigValue(raw);
  return v.length > 0 ? v : null;
}

export async function GET() {
  const { email, fromEnv } = adminCredentials();
  try {
    await ensureBoot();
    const d = await db();
    const configured = d.users.find((u) => u.email === email);
    const storage = storageStatus();
    return NextResponse.json({
      ok: storage.database !== "memory",
      storage: storage.database,
      uploads: storage.uploads,
      adminEmail: email,
      credentialsFromEnv: fromEnv,
      configuredAccountExists: !!configured,
      configuredAccountIsAdmin: !!configured?.isAdmin,
      adminCount: d.users.filter((u) => u.isAdmin).length,
      userCount: d.users.length,
      ephemeralStorage: storage.ephemeralStorage,
      missingEnvironment: storage.missingEnvironment,
      databaseKey: storage.databaseKey,
      environment: process.env.VERCEL_ENV || "local",
      commit: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 12) || null,
    }, { headers: noStore });
  } catch (e) {
    return NextResponse.json({ ok: false, ...storageStatus(), storage: storageMode(), error: "storage_unavailable", message: safeErrorMessage(e) }, { status: 503, headers: noStore });
  }
}

export async function POST(req: NextRequest) {
  try { assertDurableDatabase(); return await recover(req); }
  catch (e) { return NextResponse.json({ ok: false, error: "bootstrap_failed", message: safeErrorMessage(e) }, { status: 503, headers: noStore }); }
}

async function recover(req: NextRequest) {
  const token = setupToken();
  const provided =
    req.nextUrl.searchParams.get("token") || req.headers.get("x-setup-token") || "";

  const currentUser = await getUserFromRequest(req).catch(() => null);
  const alreadyAdmin = !!currentUser?.isAdmin;
  const noAdminYet = !(await db()).users.some((u) => u.isAdmin);
  const tokenOk = !!token && provided === token;

  if (!alreadyAdmin && !noAdminYet && !tokenOk) {
    return NextResponse.json(
      {
        error: "forbidden",
        hint: "An admin already exists. Sign in as admin, or set ADMIN_SETUP_TOKEN and pass ?token=…",
      },
      { status: 403 }
    );
  }

  const result = await ensureAdmin();
  return NextResponse.json({
    ok: true,
    email: result.email,
    created: result.created,
    updated: result.updated,
    storage: storageMode(),
  });
}
