/**
 * VK Mini App login verification.
 *
 * Lives outside the route file because Next.js validates route exports, and the
 * helper is also handy for tests. VK Bridge hands the app a `signed_token`: an
 * RS256 JWT whose keys are published by VK ID. If the platform cannot be
 * reached we fail closed — the user then signs in through the bot link token,
 * which is verified against VK's own API instead.
 */

type VkVerify = { ok: true; userId: string; name: string | null } | { ok: false; error: string };

/**
 * VK Bridge "signed app data": JWT signed with RS256, keys published at
 * id.vk.com. When the platform is unreachable we fail closed (the caller has to
 * use the bot link), which is the correct default for a payment-adjacent app.
 */
export async function verifyVkSignedToken(jwt: string, expectedAppId: string | null): Promise<VkVerify> {
  const parts = jwt.split(".");
  if (parts.length !== 3) return { ok: false, error: "malformed_token" };
  const [h, p, s] = parts;
  let header: any;
  let payload: any;
  try {
    header = JSON.parse(Buffer.from(h, "base64url").toString("utf8"));
    payload = JSON.parse(Buffer.from(p, "base64url").toString("utf8"));
  } catch {
    return { ok: false, error: "malformed_token" } as const;
  }

  const jwksUrl = "https://id.vk.com/.well-known/openid-idp-jwks";
  let keys: any[] | null = null;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 6000);
    const res = await fetch(jwksUrl, { signal: ctrl.signal, headers: { Accept: "application/json" } });
    clearTimeout(timer);
    if (res.ok) {
      const doc = await res.json();
      keys = Array.isArray(doc?.keys) ? doc.keys : null;
    }
  } catch {
    keys = null;
  }
  if (!keys?.length) return { ok: false, error: "cannot_fetch_jwks" };

  const jwk = keys.find((k) => (header.kid ? k.kid === header.kid : true)) || keys[0];
  if (!jwk) return { ok: false, error: "key_not_found" };

  try {
    const { createPublicKey, verify: cryptoVerify } = await import("crypto");
    const key = createPublicKey({ format: "jwk", key: jwk });
    const ok = cryptoVerify("RSA-SHA256", Buffer.from(`${h}.${p}`), key, Buffer.from(s, "base64url"));
    if (!ok) return { ok: false, error: "bad_signature" };
  } catch (e) {
    return { ok: false, error: "signature_check_failed" };
  }

  if (expectedAppId && payload.app_id && String(payload.app_id) !== String(expectedAppId)) {
    return { ok: false, error: "app_id_mismatch" };
  }
  const exp = Number(payload.exp || 0);
  if (exp && exp * 1000 < Date.now()) return { ok: false, error: "expired" };

  const uid = payload.sub ? String(payload.sub) : null;
  if (!uid) return { ok: false, error: "no_subject" };
  return { ok: true, userId: uid, name: typeof payload.family_name === "string" ? `${payload.given_name || ""} ${payload.family_name}`.trim() : null };
}
