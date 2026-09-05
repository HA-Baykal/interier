import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, AuthError } from "@/lib/auth";
import { db } from "@/lib/db";
import { adminSettingsView, updateAdminSettings } from "@/lib/admin-settings";
import { RequestError, safeErrorMessage } from "@/lib/errors";

export const dynamic = "force-dynamic";

function failure(e: unknown) {
  if (e instanceof AuthError) return NextResponse.json({ error: e.code }, { status: 403 });
  return NextResponse.json({ error: e instanceof RequestError ? e.code : "settings_failed", message: safeErrorMessage(e) }, { status: e instanceof RequestError ? e.status : 500 });
}

export async function GET(req: NextRequest) {
  try {
    await requireAdmin(req);
    const d = await db();
    return NextResponse.json({
      settings: adminSettingsView(d),
      stats: { users: d.users.length, generations: d.generations.length,
        credits: d.users.reduce((a, u) => a + u.credits, 0), referrals: d.referrals.filter((r) => r.rewarded).length },
      env: { hasReplicate: !!process.env.REPLICATE_API_TOKEN, hasOpenAI: !!process.env.OPENAI_API_KEY,
        hasTogether: !!process.env.TOGETHER_API_KEY || !!process.env.FAL_API_KEY },
    }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (e) { return failure(e); }
}

export async function PUT(req: NextRequest) {
  try {
    await requireAdmin(req);
    const settings = await updateAdminSettings(await req.json().catch(() => null));
    return NextResponse.json({ ok: true, settings }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (e) { return failure(e); }
}
