import { NextRequest, NextResponse } from "next/server";
import { requireUser, AuthError } from "@/lib/auth";
import { assertIdentityVerified } from "@/lib/identity";
import { assertSameOrigin } from "@/lib/request-origin";
import { RequestError, safeErrorMessage } from "@/lib/errors";

/** A posted username/ID is not proof of subscribing. Fail closed until real platform checks are connected. */
export async function POST(req: NextRequest) {
  try {
    assertSameOrigin(req);
    const user = await requireUser(req);
    assertIdentityVerified(user);
    return NextResponse.json({ error: "reward_verification_not_configured", message: "Проверка подписки через API платформы ещё не подключена. Бонус за введённое имя или ID не начисляется." }, { status: 503 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof AuthError ? e.code : e instanceof RequestError ? e.code : "reward_unavailable", message: e instanceof AuthError ? "Войдите в аккаунт." : safeErrorMessage(e) },
      { status: e instanceof AuthError ? 401 : e instanceof RequestError ? e.status : 503 });
  }
}
