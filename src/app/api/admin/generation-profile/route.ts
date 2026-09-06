import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { AuthError, requireAdmin } from "@/lib/auth";
import { activateGenApiProfile } from "@/lib/admin-settings";
import { RequestError, safeErrorMessage } from "@/lib/errors";
import { assertSameOrigin } from "@/lib/request-origin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;
const headers = { "Cache-Control": "private, no-store" };
const schema = z.object({ profileId: z.string().min(1).max(80) }).strict();

export async function PUT(req: NextRequest) {
  try {
    assertSameOrigin(req);
    await requireAdmin(req);
    const parsed = schema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) throw new RequestError("bad_request", "Выберите модель из списка.");
    const settings = await activateGenApiProfile(parsed.data.profileId);
    return NextResponse.json({ ok: true, settings }, { headers });
  } catch (e) {
    return NextResponse.json({ error: e instanceof AuthError ? e.code : e instanceof RequestError ? e.code : "profile_failed", message: e instanceof AuthError ? "Нужен доступ администратора." : safeErrorMessage(e) },
      { status: e instanceof AuthError ? 403 : e instanceof RequestError ? e.status : 503, headers });
  }
}
