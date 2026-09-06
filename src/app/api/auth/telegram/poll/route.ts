import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getUserFromRequest, isSecureRequest, SESSION_COOKIE, sessionCookieOptions } from "@/lib/auth";
import { assertSameOrigin } from "@/lib/request-origin";
import { RequestError } from "@/lib/errors";
import { pollTelegramLogin } from "@/lib/telegram/login";
import { authFailure, privateHeaders } from "@/lib/auth-response";
import { enforceRateLimit, requestClientBucket } from "@/lib/security-store";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;
const schema = z.object({ id: z.string().regex(/^[a-f0-9]{32}$/), secret: z.string().regex(/^[a-f0-9]{64}$/), cancel: z.boolean().optional() }).strict();
export async function POST(req: NextRequest) {
  try {
    assertSameOrigin(req);
    const parsed = schema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) throw new RequestError("bad_request", "Некорректный запрос входа.");
    await enforceRateLimit("telegram-poll-ip", requestClientBucket(req), 300, 60_000);
    const result = await pollTelegramLogin({ ...parsed.data, getOwner: () => getUserFromRequest(req) });
    const response = NextResponse.json({ ok: true, ...result }, { headers: privateHeaders });
    if (result.status === "authenticated") response.cookies.set(SESSION_COOKIE, result.token, sessionCookieOptions(isSecureRequest(req)));
    return response;
  } catch (e) { return authFailure(e); }
}
