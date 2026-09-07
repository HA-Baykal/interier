import { createHmac, timingSafeEqual, randomUUID } from "node:crypto";
import { getSetting } from "./config";

/**
 * YooKassa (ЮKassa) integration.
 *
 * Keys live in Vercel env (YOOKASSA_SHOP_ID / YOOKASSA_SECRET_KEY); the shop id
 * may also be set in the admin panel. While the keys are absent the store stays
 * in «Купить (скоро)» mode, so deploying this code before approval is safe.
 */

export function paymentsConfiguredSync(): boolean {
  return !!(process.env.YOOKASSA_SHOP_ID && process.env.YOOKASSA_SECRET_KEY);
}

export async function paymentsConfig(): Promise<{ shopId: string; secret: string; configured: boolean }> {
  const shopId = process.env.YOOKASSA_SHOP_ID || (await getSetting("yookassa_shop_id")) || "";
  const secret = process.env.YOOKASSA_SECRET_KEY || (await getSetting("yookassa_secret_key")) || "";
  return { shopId, secret, configured: !!shopId && !!secret };
}

/** Async check that also honours admin-panel settings (not only env). */
export async function paymentsConfigured(): Promise<boolean> {
  return (await paymentsConfig()).configured;
}

const API = "https://api.yookassa.ru/v3";

export type YooPayment = { id: string; confirmationUrl: string };

export async function createYooPayment(opts: {
  amountRub: number;
  description: string;
  returnUrl: string;
  metadata: Record<string, string>;
}): Promise<YooPayment> {
  const { shopId, secret, configured } = await paymentsConfig();
  if (!configured) throw new Error("payments_not_configured");
  const auth = Buffer.from(`${shopId}:${secret}`).toString("base64");
  const res = await fetch(`${API}/payments`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/json",
      "Idempotence-Key": randomUUID(),
    },
    body: JSON.stringify({
      amount: { value: opts.amountRub.toFixed(2), currency: "RUB" },
      capture: true,
      confirmation: { type: "redirect", return_url: opts.returnUrl },
      description: opts.description,
      metadata: opts.metadata,
    }),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok || !json?.confirmation?.confirmation_url) {
    throw new Error(String((json as any)?.description || (json as any)?.message || res.status));
  }
  return { id: json.id, confirmationUrl: json.confirmation.confirmation_url };
}

/**
 * YooKassa signs notifications with HMAC-SHA256 of the raw body using the shop
 * secret, base64-encoded, in `X-YooKassa-Signature`. We also accept hex for
 * robustness across gateway re-encodings.
 */
export function verifyYooSignature(rawBody: string, signature: string, secret: string): boolean {
  if (!signature || !secret) return false;
  const hmac = createHmac("sha256", secret).update(rawBody, "utf8");
  const candidates = [hmac.digest("base64"), createHmac("sha256", secret).update(rawBody, "utf8").digest("hex")];
  return candidates.some((c) => {
    try {
      const a = Buffer.from(c);
      const b = Buffer.from(signature);
      return a.length === b.length && timingSafeEqual(a, b);
    } catch {
      return false;
    }
  });
}
