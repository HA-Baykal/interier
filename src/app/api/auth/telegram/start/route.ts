import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getUserFromRequest } from "@/lib/auth";
import { assertSameOrigin } from "@/lib/request-origin";
import { RequestError } from "@/lib/errors";
import { startTelegramLogin } from "@/lib/telegram/login";
import { authFailure, privateHeaders } from "@/lib/auth-response";
import { requestClientBucket } from "@/lib/security-store";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;
const schema = z.object({ purpose: z.enum(["login", "link"]).default("login"), referralCode: z.string().max(40).optional() }).strict();
export async function POST(req: NextRequest) {
  try {
    assertSameOrigin(req);
    const data = schema.safeParse(await req.json().catch(() => null));
    if (!data.success) throw new RequestError("bad_request", "Некорректный запрос входа.");
    const owner = data.data.purpose === "link" ? await getUserFromRequest(req) : undefined;
    const challenge = await startTelegramLogin({ ...data.data, owner: owner || undefined, clientBucket: requestClientBucket(req) });
    return NextResponse.json({ ok: true, challenge }, { headers: privateHeaders });
  } catch (e) { return authFailure(e); }
}
