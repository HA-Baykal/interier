/**
 * Telegram Stars (XTR) payments.
 *
 * Stars are Telegram's own currency: the buyer pays inside the Mini App with a
 * card via `Telegram.WebApp.openInvoice`, the bot receives the Stars, and
 * Telegram notifies us with `pre_checkout_query` (we approve) and then
 * `successful_payment` (we grant the package credits). No crypto wallet and no
 * third-party checkout — everything stays inside Telegram.
 *
 * Credits are granted exactly once per payment (idempotent by our payment id),
 * mirroring the YooKassa webhook, so a redelivered update never double-credits.
 */

import { mutate, uid, now } from "./db";
import { getSettingNumber, activePackages } from "./config";
import { addCredits } from "./billing";
import { tgCall } from "./bots/telegramApi";
import { telegramConfig } from "./bots/config";

/** Stars are available as soon as the bot token is set (no extra keys). */
export async function starsConfigured(): Promise<boolean> {
  const cfg = await telegramConfig();
  return !!cfg.token;
}

/** How many Stars cover 1 ₽. Admin-tunable (`stars_per_rub`); default 1. */
export async function starsRate(): Promise<number> {
  const r = await getSettingNumber("stars_per_rub", 1);
  return r > 0 ? r : 1;
}

export function starsPriceFor(rubPrice: number, rate: number): number {
  return Math.max(1, Math.round(rubPrice * rate));
}

/**
 * Create a Stars invoice and return its link. The Mini App opens it with
 * `Telegram.WebApp.openInvoice(url)`; the `payload` carries our payment id so
 * the `successful_payment` update can be matched back to the package.
 */
export async function createStarsInvoiceLink(
  userId: string,
  packageId: string
): Promise<{ url: string; stars: number; paymentId: string }> {
  const cfg = await telegramConfig();
  if (!cfg.token) throw new Error("stars_not_configured");
  const pack = (await activePackages()).find((p) => p.id === packageId);
  if (!pack) throw new Error("not_found");

  const rate = await starsRate();
  const stars = starsPriceFor(pack.price, rate);
  const label = `Interier — ${pack.name.ru}`.slice(0, 32);

  const paymentId = uid("pay");
  await mutate((d) => {
    d.payments.push({
      id: paymentId,
      yookassaId: "",
      userId,
      packageId: pack.id,
      amountRub: pack.price,
      credits: pack.credits,
      status: "pending",
      createdAt: now(),
      provider: "stars",
      externalId: paymentId,
    });
  });

  const r = await tgCall<{ ok: boolean; result?: string; description?: string }>("createInvoiceLink", {
    title: label,
    description: `${pack.credits} генераций дизайна интерьера`.slice(0, 255),
    payload: `stars:${paymentId}`,
    currency: "XTR",
    prices: [{ label, amount: stars }],
  });
  if (!r?.ok || !r.result) throw new Error(r?.description || "invoice_failed");
  return { url: r.result, stars, paymentId };
}

/**
 * Grant the package credits for a successful Stars payment. Idempotent: a
 * payment already marked `paid` grants nothing, so Telegram's redeliveries and
 * our own retries are safe.
 */
export async function fulfillStarsPayment(
  invoicePayload: string,
  chargeId: string
): Promise<{ granted: boolean; credits: number; userId: string | null }> {
  if (!invoicePayload || !invoicePayload.startsWith("stars:")) {
    return { granted: false, credits: 0, userId: null };
  }
  const paymentId = invoicePayload.slice("stars:".length);
  const target = await mutate<{ userId: string; credits: number } | null>((d) => {
    const p = d.payments.find((x) => x.id === paymentId && x.provider === "stars");
    if (!p || p.status === "paid") return null; // already granted — idempotent
    p.status = "paid";
    if (chargeId) p.externalId = chargeId;
    return { userId: p.userId, credits: p.credits };
  });
  if (!target) return { granted: false, credits: 0, userId: null };
  await addCredits(target.userId, target.credits);
  return { granted: true, credits: target.credits, userId: target.userId };
}
