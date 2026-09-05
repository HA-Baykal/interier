import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { clearSessionCookie, destroySession, isSecureRequest } from "@/lib/auth";

export async function POST(req: NextRequest) {
  const token = cookies().get("interier_session")?.value;
  if (token) await destroySession(token);
  clearSessionCookie(isSecureRequest(req));
  return NextResponse.json({ ok: true });
}
