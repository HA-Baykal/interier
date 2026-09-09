/**
 * TON payments via TON Connect.
 *
 * The buyer connects a TON wallet inside the Mini App (TON Connect) and sends
 * TON straight to the owner's address with a unique comment (our payment id).
 * We then verify the transfer on-chain through the TON API (tonapi.io) and
 * grant the package credits exactly once (idempotent by payment id), the same
 * pattern as YooKassa and Telegram Stars. No custodian, no third-party checkout.
 */

import { mutate, uid, now } from "./db";
import { getSetting, getSettingNumber, activePackages } from "./config";
import { addCredits } from "./billing";
import { Address } from "@ton/core";

export type TonConfig = { address: string; apiKey: string; apiBase: string; configured: boolean };

export async function tonConfig(): Promise<TonConfig> {
  const address = ((await getSetting("ton_address")) || process.env.TON_ADDRESS || "").trim();
  const apiKey = ((await getSetting("ton_api_key")) || process.env.TON_API_KEY || "").trim();
  const apiBase = ((await getSetting("ton_api_base")) || process.env.TON_API_BASE || "https://tonapi.io").replace(/\/+$/, "");
  return { address, apiKey, apiBase, configured: !!address };
}

export async function tonConfigured(): Promise<boolean> {
  return (await tonConfig()).configured;
}

/** TON per 1 ₽ (admin-tunable `ton_per_rub`); default 0.01. */
export async function tonRate(): Promise<number> {
  const r = await getSettingNumber("ton_per_rub", 0.01);
  return r > 0 ? r : 0.01;
}

/** Whole nanoton (1 TON = 1e9 nano) for a ruble price at the given rate. */
export function tonAmountNano(rubPrice: number, rate: number): bigint {
  const nano = Math.round(rubPrice * rate * 1e9);
  return BigInt(Math.max(1, nano));
}

export type TonInvoice = { address: string; amountNano: string; amountTon: string; memo: string; paymentId: string };

/** Create a pending TON payment and return what the wallet must send. */
export async function createTonPayment(userId: string, packageId: string): Promise<TonInvoice> {
  const cfg = await tonConfig();
  if (!cfg.configured) throw new Error("ton_not_configured");
  const pack = (await activePackages()).find((p) => p.id === packageId);
  if (!pack) throw new Error("not_found");

  const rate = await tonRate();
  const amountNano = tonAmountNano(pack.price, rate);
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
      provider: "ton",
      externalId: paymentId, // the memo the buyer must attach
      expectedNano: amountNano.toString(), // freeze the amount at creation time
    });
  });

  return {
    address: cfg.address,
    amountNano: amountNano.toString(),
    amountTon: (Number(amountNano) / 1e9).toFixed(4),
    memo: paymentId,
    paymentId,
  };
}

/** Grant credits for a confirmed TON transfer. Idempotent by payment id. */
export async function fulfillTonPayment(
  paymentId: string,
  txId: string
): Promise<{ granted: boolean; credits: number; userId: string | null }> {
  const target = await mutate<{ userId: string; credits: number } | null>((d) => {
    const p = d.payments.find((x) => x.id === paymentId && x.provider === "ton");
    if (!p || p.status === "paid") return null; // already granted — idempotent
    p.status = "paid";
    if (txId) p.externalId = txId;
    return { userId: p.userId, credits: p.credits };
  });
  if (!target) return { granted: false, credits: 0, userId: null };
  await addCredits(target.userId, target.credits);
  return { granted: true, credits: target.credits, userId: target.userId };
}

/** Pull the expected nano amount for a pending TON payment (0 if unknown). */
export async function expectedNanoFor(paymentId: string): Promise<bigint> {
  const { db } = await import("./db");
  const p = (await db()).payments.find((x) => x.id === paymentId && x.provider === "ton");
  if (!p) return 0n;
  // The amount is frozen at invoice creation, so an admin changing `ton_per_rub`
  // mid-flight never alters what this pending payment must confirm for.
  if (p.expectedNano) {
    const stored = BigInt(p.expectedNano);
    if (stored > 0n) return stored;
  }
  // Fallback for payments created before expectedNano existed.
  const pack = (await activePackages()).find((x) => x.id === p.packageId);
  const rate = await tonRate();
  return tonAmountNano(pack?.price ?? p.amountRub, rate);
}

export type TonTx = { id: string; nano: bigint; comment: string };

/**
 * Compare two TON addresses regardless of representation: raw (`0:...`) and
 * friendly (`UQ...` / `EQ...` / `kQ...` / `0Q...` all parse to the same raw).
 * An exact-string match is a fast path; @ton/core does the normalization.
 */
export function sameTonAddress(a: string | null | undefined, b: string): boolean {
  if (!a || !b) return false;
  if (a === b) return true;
  try {
    return Address.parse(a).equals(Address.parse(b));
  } catch {
    return false;
  }
}

/**
 * NanoTON amount of a TonAPI TonTransfer action. The API exposes it as an
 * object `{ value: "123" }`; older responses carried the plain string. Returns
 * 0n when the field is missing so the caller can refuse the event (fail closed).
 */
function transferNano(transfer: Record<string, unknown>): bigint {
  const amount = transfer.amount;
  const value =
    amount && typeof amount === "object"
      ? (amount as { value?: unknown }).value
      : amount;
  if (value === undefined || value === null) return 0n;
  try {
    return BigInt(String(value));
  } catch {
    return 0n;
  }
}

/**
 * Look up an incoming transfer to our address whose comment contains `memo` and
 * whose value is at least `minNano`. Uses tonapi.io v2 account events. Returns
 * null when nothing matching is found (or the API is unavailable).
 */
export async function findTonTransfer(
  memo: string,
  minNano: bigint
): Promise<TonTx | null> {
  const cfg = await tonConfig();
  if (!cfg.configured) return null;
  const headers: Record<string, string> = { Accept: "application/json" };
  if (cfg.apiKey) headers.Authorization = `Bearer ${cfg.apiKey}`;
  try {
    const url = `${cfg.apiBase}/v2/blockchain/accounts/${encodeURIComponent(cfg.address)}/events?limit=100`;
    const res = await fetch(url, { headers, cache: "no-store" });
    if (!res.ok) return null;
    const data = (await res.json()) as { events?: any[] };
    for (const ev of data.events || []) {
      for (const action of ev.actions || []) {
        if (action?.type !== "TonTransfer") continue;
        const transfer = action.TonTransfer;
        if (!transfer) continue;
        // Only incoming transfers count: the recipient must be OUR address
        // (matched by raw address, whatever spelling was configured/pasted).
        const recipient: unknown = transfer.recipient?.address;
        if (!sameTonAddress(recipient as string, cfg.address)) continue;
        const comment = String(transfer.comment || "");
        if (!comment.includes(memo)) continue;
        const nano = transferNano(transfer);
        if (nano < minNano) continue; // underpaid is not a payment
        return { id: String(ev.event_id || ev.id || comment), nano, comment };
      }
    }
  } catch {
    return null;
  }
  return null;
}

/** Verify a pending TON payment on-chain and grant credits if it arrived. */
export async function verifyTonPayment(
  paymentId: string,
  ownerUserId?: string | null
): Promise<{ status: "pending" | "paid" | "unknown"; granted: boolean; credits: number }> {
  const { db } = await import("./db");
  const p = (await db()).payments.find((x) => x.id === paymentId && x.provider === "ton");
  if (!p) return { status: "unknown", granted: false, credits: 0 };
  // A user may only confirm their own payment; foreign ids are not revealed.
  if (ownerUserId && p.userId !== ownerUserId) return { status: "unknown", granted: false, credits: 0 };
  if (p.status === "paid") return { status: "paid", granted: false, credits: 0 };

  const minNano = await expectedNanoFor(paymentId);
  const tx = await findTonTransfer(paymentId, minNano);
  if (!tx) return { status: "pending", granted: false, credits: 0 };

  const res = await fulfillTonPayment(paymentId, tx.id);
  return { status: "paid", granted: res.granted, credits: res.credits };
}
