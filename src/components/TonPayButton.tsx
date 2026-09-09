"use client";

/**
 * Pay for a package with TON via TON Connect.
 *
 * Flow: create a pending payment on the server (we get the owner's address, the
 * exact nano amount and a unique memo), let the buyer connect a wallet and send
 * the transfer with that memo, then poll the server which verifies the transfer
 * on-chain (tonapi.io) and grants the credits exactly once.
 *
 * A blockchain confirmation can take longer than one poll window, so when the
 * first check window expires the button switches to «Проверить ещё раз» instead
 * of leaving the user stuck with a dead error.
 */

import { useEffect, useRef, useState } from "react";
import { beginCell } from "@ton/core";
import { TonConnectUI } from "@tonconnect/ui";
import { authHeaders } from "@/lib/client-auth";
import { useLocale } from "./locale-context";

/** Text-comment payload (op = 0) so the transfer carries our memo. */
function commentPayload(text: string): string {
  return beginCell().storeUint(0, 32).storeStringTail(text).endCell().toBoc().toString("base64");
}

export default function TonPayButton({ packageId, onPaid }: { packageId: string; onPaid: () => void }) {
  const { t } = useLocale();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [paymentId, setPaymentId] = useState<string | null>(null);
  const uiRef = useRef<TonConnectUI | null>(null);

  useEffect(() => () => {
    uiRef.current = null;
  }, []);

  function connector(): TonConnectUI {
    if (!uiRef.current) {
      const origin = typeof window !== "undefined" ? window.location.origin : "";
      uiRef.current = new TonConnectUI({ manifestUrl: `${origin}/api/tonconnect/manifest` });
    }
    return uiRef.current;
  }

  /** Ask the server whether the transfer arrived; grant fires server-side. */
  async function checkOnce(id: string): Promise<boolean> {
    const check = await fetch("/api/payments/ton/verify", {
      method: "POST",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ paymentId: id }),
    });
    const c = await check.json().catch(() => ({}));
    if (c.status === "paid") {
      onPaid();
      return true;
    }
    return false;
  }

  /** Poll for the confirmation up to `attempts` times, 3 s apart. */
  async function pollUntilPaid(id: string, attempts: number): Promise<boolean> {
    for (let i = 0; i < attempts; i++) {
      await new Promise((r) => setTimeout(r, 3000));
      if (await checkOnce(id)) return true;
    }
    return false;
  }

  async function pay() {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch("/api/payments/ton/create", {
        method: "POST",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ packageId }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok || !d.address) {
        setError(d.message ? String(d.message) : t("pay_error"));
        return;
      }

      const ui = connector();
      if (!ui.wallet) {
        await ui.openModal();
      }
      if (!ui.wallet) {
        setError(t("pay_ton_wallet_needed"));
        return;
      }

      await ui.sendTransaction({
        validUntil: Math.floor(Date.now() / 1000) + 600,
        messages: [
          {
            address: d.address,
            amount: String(d.amountNano),
            payload: commentPayload(d.memo),
          },
        ],
      });

      // The transfer is broadcast; confirmations usually land within seconds,
      // but on a congested network it can take longer — keep the payment id so
      // the user can re-check instead of losing the money silently.
      setPaymentId(String(d.paymentId));
      const paid = await pollUntilPaid(String(d.paymentId), 20);
      if (!paid) setError(t("pay_ton_wait"));
    } catch (e) {
      const msg = e && typeof e === "object" && "message" in e ? String((e as any).message) : "";
      // The user closing the wallet modal is not an error worth shouting about.
      if (msg && !/cancel|reject|close|disconnect/i.test(msg)) setError(msg);
    } finally {
      setBusy(false);
    }
  }

  async function checkAgain() {
    if (!paymentId) return;
    setError(null);
    setBusy(true);
    try {
      // The transfer may simply have been slow: give it several more windows.
      const paid = await pollUntilPaid(paymentId, 8);
      if (!paid) setError(t("pay_ton_wait"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button className="btn btn-ghost btn-sm" disabled={busy} onClick={pay}>
        {busy ? t("common_loading") : `💎 ${t("pay_ton")}`}
      </button>
      {paymentId && !busy && (
        <button className="btn btn-ghost btn-sm" onClick={checkAgain}>
          🔄 {t("pay_ton_retry")}
        </button>
      )}
      {error && <p className="err small" style={{ marginTop: 6 }}>{error}</p>}
    </>
  );
}
