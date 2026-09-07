"use client";

import { useState } from "react";
import { useLocale } from "./locale-context";
import { authHeaders } from "@/lib/client-auth";

/**
 * Package buy button. While YooKassa keys are not configured the store is in
 * «Купить (скоро)» mode (disabled). Once payments are live it creates a payment
 * and redirects the buyer to the YooKassa checkout.
 */
export default function BuyButton({ packageId, enabled }: { packageId: string; enabled: boolean }) {
  const { t } = useLocale();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function buy() {
    setErr(null);
    setBusy(true);
    try {
      const res = await fetch("/api/payments/create", {
        method: "POST",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ packageId }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok || !d.confirmationUrl) {
        setErr(t("pay_error"));
        return;
      }
      window.location.href = d.confirmationUrl;
    } catch {
      setErr(t("pay_error"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {enabled ? (
        <button className="btn btn-primary" onClick={buy} disabled={busy}>
          {busy ? t("pay_redirecting") : t("buy_pay")}
        </button>
      ) : (
        <button className="btn btn-ghost" disabled title={t("buy_disabled")}>
          {t("buy_label")}
        </button>
      )}
      {err && <p className="err small" style={{ marginTop: 8 }}>{err}</p>}
    </>
  );
}
