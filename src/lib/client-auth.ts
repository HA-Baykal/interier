"use client";

const STORAGE_KEY = "interier_token";

/**
 * Client-side session-token access.
 *
 * The Arena preview may serve the app in a context where the browser refuses
 * to persist/echo the session *cookie* (e.g. third-party-cookie blocking or a
 * cross-site frame). To make login bulletproof, we keep the session token in
 * sessionStorage and pass it as the `x-session-token` header on every API call,
 * and as the `?ses=` query param for server-rendered pages. The cookie is kept
 * as a fallback for normal first-party deployments.
 */

export function saveToken(token: string) {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(STORAGE_KEY, token);
  } catch {
    /* ignore quota / privacy errors */
  }
}

export function clearToken() {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

/** Get the token from ?ses= (if present) or sessionStorage. */
export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const q = new URLSearchParams(window.location.search).get("ses");
    if (q) return q;
    return window.sessionStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

/** Headers to attach to authenticated fetch() calls. */
export function authHeaders(): Record<string, string> {
  const token = getToken();
  return token ? { "x-session-token": token } : {};
}

/** Wrap a path so the session token is included for cookie-blocked browsers. */
export function withToken(path: string): string {
  const token = getToken();
  if (!token) return path;
  const sep = path.includes("?") ? "&" : "?";
  return `${path}${sep}ses=${encodeURIComponent(token)}`;
}
