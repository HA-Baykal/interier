import { NextResponse } from "next/server";
import { AuthError } from "./auth";
import { RequestError, safeErrorMessage } from "./errors";
export const privateHeaders = { "Cache-Control": "private, no-store" };
export function authFailure(error: unknown) {
  const status = error instanceof AuthError ? (error.code === "NOT_ADMIN" ? 403 : 401) : error instanceof RequestError ? error.status : 503;
  return NextResponse.json({ error: error instanceof AuthError ? error.code : error instanceof RequestError ? error.code : "auth_unavailable",
    message: error instanceof AuthError ? "Войдите в аккаунт." : error instanceof RequestError ? safeErrorMessage(error) : "Вход временно недоступен. Повторите позже." },
  { status, headers: { ...privateHeaders, ...(status === 429 ? { "Retry-After": "60" } : {}) } });
}
