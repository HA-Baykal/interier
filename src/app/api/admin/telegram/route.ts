import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { assertSameOrigin } from "@/lib/request-origin";
import { RequestError } from "@/lib/errors";
import { connectTelegram, telegramPublicStatus } from "@/lib/telegram/connection";
import { authFailure, privateHeaders } from "@/lib/auth-response";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
export async function GET(req: NextRequest) {
  try { await requireAdmin(req); return NextResponse.json(await telegramPublicStatus(), { headers: privateHeaders }); }
  catch (e) { return authFailure(e); }
}
export async function POST(req: NextRequest) {
  try {
    assertSameOrigin(req); await requireAdmin(req);
    const data = z.object({ takeOver: z.boolean().default(false) }).strict().safeParse(await req.json().catch(() => null));
    if (!data.success) throw new RequestError("bad_request", "Некорректный запрос подключения.");
    const status = await connectTelegram(data.data.takeOver);
    return NextResponse.json({ ok: true, ...status }, { headers: privateHeaders });
  } catch (e) { return authFailure(e); }
}
