"use client";

/**
 * Pay for a package with TON via TON Connect.
 *
 * Flow: create a pending payment on the server (we get the owner's address, the
 * exact nano amount and a unique memo), let the buyer connect a wallet and send
 * the transfer with that memo, then poll the server which verifies the transfer
 * on-chain (tonapi.io) and grants the credits exactly once.
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

      // The transfer is broadcast; confirmations land on-chain within seconds.
      for (let i = 0; i < 12; i++) {
        await new Promise((r) => setTimeout(r, 3000));
        const check = await fetch("/api/payments/ton/verify", {
          method: "POST",
          headers: { ...authHeaders(), "Content-Type": "application/json" },
          body: JSON.stringify({ paymentId: d.paymentId }),
        });
        const c = await check.json().catch(() => ({}));
        if (c.status === "paid") {
          onPaid();
          return;
        }
      }
      setError(t("pay_ton_checking"));
    } catch (e) {
      const msg = e && typeof e === "object" && "message" in e ? String((e as any).message) : "";
      // The user closing the wallet modal is not an error worth shouting about.
      if (msg && !/cancel|reject|close/i.test(msg)) setError(msg);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button className="btn btn-ghost btn-sm" disabled={busy} onClick={pay}>
        {busy ? t("common_loading") : `💎 ${t("pay_ton")}`}
      </button>
      {error && <p className="err small" style={{ marginTop: 6 }}>{error}</p>}
    </>
  );
}
