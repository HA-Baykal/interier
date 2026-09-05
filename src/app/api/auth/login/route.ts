import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { verifyPassword, makeSession, setSessionCookie, isSecureRequest } from "@/lib/auth";
import { logAuthDiag } from "@/lib/debug";
import { ensureBootSafe, ensureAdminAvailable } from "@/lib/boot";

const schema = z.object({
  // Keep validation permissive here: the exact reason is reported as
  // "invalid credentials" below, and a strict e-mail check used to reject
  // logins before the account was even looked up.
  email: z.string().min(1).max(200),
  password: z.string().min(1).max(200),
});

export async function POST(req: NextRequest) {
  await logAuthDiag(req, "login");

  // Cold API instances never render the layout, so make sure the database is
  // seeded (and the admin account exists) before validating a password. The
  // second call repairs a store that was emptied while this instance stayed warm.
  await ensureBootSafe();
  await ensureAdminAvailable();

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "auth_error_fields" }, { status: 400 });
  }

  // Browsers and mobile keyboards love to add a trailing space or a non-breaking
  // space when credentials are pasted; the password keeps its inner characters
  // but loses surrounding whitespace only.
  const email = parsed.data.email.replace(/\s+/g, "").toLowerCase();
  const password = parsed.data.password.replace(/\u00a0/g, " ").trim();

  const user = (await db()).users.find((u) => u.email.trim().toLowerCase() === email);

  let ok = false;
  if (user && typeof user.passwordHash === "string" && user.passwordHash.length > 0) {
    try {
      ok = verifyPassword(password, user.passwordHash);
    } catch {
      ok = false;
    }
  }

  if (!user || !ok) {
    return NextResponse.json({ error: "auth_error_invalid" }, { status: 401 });
  }

  const token = await makeSession(user.id);
  setSessionCookie(token, isSecureRequest(req));
  return NextResponse.json({ ok: true, token, isAdmin: user.isAdmin });
}
