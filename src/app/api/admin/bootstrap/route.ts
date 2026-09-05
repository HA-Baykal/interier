import { NextRequest, NextResponse } from "next/server";
import { db, storageMode } from "@/lib/db";
import { adminCredentials, ensureAdmin } from "@/lib/bootstrap";
import { getUserFromRequest } from "@/lib/auth";

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

function setupToken(): string | null {
  const raw = process.env.ADMIN_SETUP_TOKEN;
  if (!raw) return null;
  const v = String(raw).trim();
  return v.length > 0 ? v : null;
}

export async function GET() {
  const { email, fromEnv } = adminCredentials();
  const d = await db();
  const admins = d.users.filter((u) => u.isAdmin);
  const configured = d.users.find((u) => u.email === email);

  return NextResponse.json({
    storage: storageMode(),
    adminEmail: email,
    credentialsFromEnv: fromEnv,
    configuredAccountExists: !!configured,
    configuredAccountIsAdmin: !!configured?.isAdmin,
    adminCount: admins.length,
    userCount: d.users.length,
    // A memory backend means every restart wipes accounts — the most common
    // reason a working login suddenly stops working on serverless hosts.
    ephemeralStorage: storageMode() === "memory",
  });
}

export async function POST(req: NextRequest) {
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
