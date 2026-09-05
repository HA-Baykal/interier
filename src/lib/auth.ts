import { cookies } from "next/headers";
import type { NextRequest } from "next/server";
import bcrypt from "bcryptjs";
import { db, mutate, uid, now } from "./db";
import { User } from "./types";

const SESSION_COOKIE = "interier_session";
const SESSION_TOKEN_PARAM = "ses"; // query-string fallback for cookie-blocked browsers
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30; // 30 days

function secret(): string {
  return process.env.SESSION_SECRET || "dev-secret-change-me";
}

/**
 * Detect whether the incoming request is served over HTTPS.
 *
 * The Arena preview serves the app inside an iframe on a *different* origin,
 * so a `SameSite=Lax` cookie is treated as third-party and blocked by modern
 * browsers — the session cookie never persists, causing an endless login
 * redirect loop. For the preview we must use `SameSite=None; Secure`, which is
 * allowed in cross-site frames.
 *
 * We don't rely on a single header: proxies differ. A request is treated as
 * secure if (a) X-Forwarded-Proto says https, (b) the URL protocol is https,
 * or (c) the host is NOT the plain localhost/127.0.0.1 dev server (i.e. it is
 * the public preview/production domain, which is always served over HTTPS).
 */
export function isSecureRequest(req?: NextRequest): boolean {
  if (!req) return false;

  try {
    const forwarded = (req.headers.get("x-forwarded-proto") || "").toLowerCase();
    if (forwarded.includes("https")) return true;

    if (req.nextUrl.protocol === "https:") return true;

    const host = (
      req.headers.get("x-forwarded-host") ||
      req.headers.get("host") ||
      ""
    ).toLowerCase();

    const isLocalhost =
      host.startsWith("localhost") ||
      host.startsWith("127.0.0.1") ||
      host.startsWith("[::1]");

    // Local dev over plain http stays Lax; anything else (the public preview /
    // production domain) is always served over HTTPS, so allow the cross-site
    // cookie.
    return !isLocalhost;
  } catch {
    // If anything unexpected happens, be conservative and allow the cross-site
    // cookie by defaulting to secure, so the login loop is avoided.
    return true;
  }
}

export function sessionCookieOptions(isSecure: boolean) {
  return {
    httpOnly: true,
    // HTTPS/cross-site iframe -> must be None so the browser keeps it.
    sameSite: (isSecure ? "none" : "lax") as "none" | "lax",
    path: "/",
    maxAge: SESSION_TTL_MS / 1000,
    // SameSite=None is rejected by browsers without Secure, so enable it.
    secure: isSecure,
  };
}

export function hashPassword(password: string): string {
  return bcrypt.hashSync(password, 10);
}

export function verifyPassword(password: string, hash: string): boolean {
  return bcrypt.compareSync(password, hash);
}

export async function makeSession(userId: string): Promise<string> {
  const token = uid("sess");
  await mutate((d) => {
    d.sessions.push({
      token,
      userId,
      createdAt: now(),
      expiresAt: now() + SESSION_TTL_MS,
    });
  });
  return token;
}

/** Resolve the session token from any of the available sources. */
export function resolveSessionToken(opts: {
  cookieVal?: string | null;
  headerVal?: string | null;
  queryVal?: string | null;
}): string | null {
  return opts.cookieVal || opts.headerVal || opts.queryVal || null;
}

/** Resolve a user from a raw session token (cookie/header/query). */
export async function getUserByToken(token: string | null | undefined): Promise<User | null> {
  if (!token) return null;
  const d = await db();
  const session = d.sessions.find((s) => s.token === token);
  if (!session || session.expiresAt < now()) return null;
  return d.users.find((u) => u.id === session.userId) || null;
}

/** Resolve the current user from a NextRequest (cookie, header or ?ses= query). */
export async function getUserFromRequest(req: NextRequest): Promise<User | null> {
  const token = resolveSessionToken({
    cookieVal: req.cookies.get(SESSION_COOKIE)?.value,
    headerVal: req.headers.get("x-session-token"),
    queryVal: req.nextUrl.searchParams.get(SESSION_TOKEN_PARAM),
  });
  return getUserByToken(token);
}

export function setSessionCookie(token: string, isSecure = false) {
  cookies().set(SESSION_COOKIE, token, sessionCookieOptions(isSecure));
}

export function clearSessionCookie(isSecure = false) {
  cookies().set(SESSION_COOKIE, "", {
    ...sessionCookieOptions(isSecure),
    maxAge: 0,
  });
}

export async function getSessionUser(): Promise<User | null> {
  const token = cookies().get(SESSION_COOKIE)?.value;
  return getUserByToken(token);
}

/**
 * Resolve the user for a server-rendered page. Checks the cookie first, then
 * the `?ses=` query token (for cookie-blocked browsers). If the user is only
 * found via the URL token, we also promote it into a cookie so subsequent
 * in-app navigations keep working without the query string.
 */
export async function resolvePageUser(queryVal?: string | null): Promise<User | null> {
  const cookieUser = await getSessionUser();
  if (cookieUser) return cookieUser;

  const fromQuery = await getUserByToken(queryVal);
  if (fromQuery) {
    // Promote the URL token into a cookie (best-effort; works over first-party
    // HTTPS, harmless otherwise).
    try {
      if (queryVal) setSessionCookie(queryVal, true);
    } catch {
      /* noop */
    }
    return fromQuery;
  }
  return null;
}

export async function requireUser(req?: NextRequest): Promise<User> {
  const user = req ? await getUserFromRequest(req) : await getSessionUser();
  if (!user) throw new AuthError("NOT_AUTHENTICATED");
  return user;
}

export async function requireAdmin(req?: NextRequest): Promise<User> {
  const user = await requireUser(req);
  if (!user.isAdmin) throw new AuthError("NOT_ADMIN");
  return user;
}

export async function destroySession(token: string) {
  await mutate((d) => {
    d.sessions = d.sessions.filter((s) => s.token !== token);
  });
}

export class AuthError extends Error {
  code: string;
  constructor(code: string) {
    super(code);
    this.code = code;
  }
}

/** Deterministic-ish referral code generator that stays unique. */
export async function makeReferralCode(email: string): Promise<string> {
  const base = email
    .replace(/[^a-zA-Z0-9]/g, "")
    .slice(0, 6)
    .toUpperCase() || "USER";
  const d = await db();
  let code = `${base}${Math.floor(1000 + Math.random() * 9000)}`;
  while (d.users.some((u) => u.referralCode === code)) {
    code = `${base}${Math.floor(1000 + Math.random() * 9000)}`;
  }
  return code;
}
