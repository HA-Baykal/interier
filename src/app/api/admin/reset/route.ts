import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, AuthError } from "@/lib/auth";
import { resetDb } from "@/lib/db";

export async function POST(req: NextRequest) {
  try {
    await requireAdmin(req);
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.code }, { status: 403 });
    throw e;
  }
  await resetDb();
  // Re-seed styles / packages / settings and re-create the admin account.
  const { ensureSeeded } = await import("@/lib/config");
  await ensureSeeded();
  const { ensureAdmin, ensureGalleryExamples } = await import("@/lib/bootstrap");
  const admin = await ensureAdmin();
  await ensureGalleryExamples();
  return NextResponse.json({ ok: true, admin: admin.email });
}
