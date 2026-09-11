import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireUser, AuthError } from "@/lib/auth";
import { RequestError, safeErrorMessage } from "@/lib/errors";
import { createPaymentOrder } from "@/lib/yookassa";
import { publicBaseUrl } from "@/lib/bots/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  packageId: z.string().min(1),
});

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser(req);
    const body = await req.json().catch(() => ({}));
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      throw new RequestError("invalid_payload", "Не указан тарифный пакет для покупки.", 400);
    }

    const { packageId } = parsed.data;
    const d = await db();
    const pkg = d.packages.find((p) => p.id === packageId && p.active);
    if (!pkg) {
      throw new RequestError("package_not_found", "Тарифный план не найден или неактивен.", 404);
    }

    const host = req.headers.get("x-forwarded-host") || req.headers.get("host") || "localhost:3000";
    const baseUrl = await publicBaseUrl(host);

    const result = await createPaymentOrder(user, pkg, baseUrl);
    return NextResponse.json(result);
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ error: e.code, message: "Требуется авторизация" }, { status: 401 });
    }
    const message = safeErrorMessage(e);
    return NextResponse.json(
      { error: e instanceof RequestError ? e.code : "payment_failed", message },
      { status: e instanceof RequestError ? e.status : 500 }
    );
  }
}
