import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, AuthError } from "@/lib/auth";
import { resetDb } from "@/lib/db";

export async function POST(req: NextRequest) {
  try {
    requireAdmin(req);
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.code }, { status: 403 });
    throw e;
  }
  resetDb();
  // Re-seed styles / packages / settings and re-create the admin account.
  const { ensureSeeded } = await import("@/lib/config");
  ensureSeeded();
  const { ensureAdmin } = await import("@/lib/bootstrap");
  ensureAdmin();
  return NextResponse.json({ ok: true });
}
