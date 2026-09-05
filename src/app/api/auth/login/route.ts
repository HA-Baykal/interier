import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { verifyPassword, makeSession, setSessionCookie, isSecureRequest } from "@/lib/auth";
import { logAuthDiag } from "@/lib/debug";

const schema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export async function POST(req: NextRequest) {
  await logAuthDiag(req, "login");
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "auth_error_fields" }, { status: 400 });
  }

  const email = parsed.data.email.toLowerCase().trim();
  const user = (await db()).users.find((u) => u.email === email);
  if (!user || !verifyPassword(parsed.data.password, user.passwordHash)) {
    return NextResponse.json({ error: "auth_error_invalid" }, { status: 401 });
  }

  const token = await makeSession(user.id);
  setSessionCookie(token, isSecureRequest(req));
  return NextResponse.json({ ok: true, token });
}
