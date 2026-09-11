"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ClientPackage } from "./types";
import { t } from "@/lib/i18n";
import type { Locale } from "@/lib/types";

export default function PricingSection({
  packages,
  locale,
  isLoggedIn,
}: {
  packages: ClientPackage[];
  locale: Locale;
  isLoggedIn: boolean;
}) {
  const router = useRouter();
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleBuy = async (pkg: ClientPackage) => {
    if (!isLoggedIn) {
      router.push(`/login?redirect=/#pricing`);
      return;
    }

    setLoadingId(pkg.id);
    setErrorMsg(null);
    setSuccessMsg(null);

    try {
      const res = await fetch("/api/payments/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ packageId: pkg.id }),
      });

      const data = await res.json();
      if (!res.ok || !data.ok) {
        throw new Error(data.message || data.error || "Ошибка создания платежа");
      }

      if (data.confirmationUrl) {
        window.location.href = data.confirmationUrl;
        return;
      }

      if (data.isTest) {
        setSuccessMsg(
          locale === "ru"
            ? `🎉 Тестовая оплата прошла успешно! Начислено +${data.creditsAdded || pkg.credits} генераций.`
            : `🎉 Test payment successful! Added +${data.creditsAdded || pkg.credits} credits.`
        );
        setTimeout(() => {
          router.push("/studio");
          router.refresh();
        }, 1500);
      }
    } catch (e: any) {
      setErrorMsg(e.message || "Не удалось создать заказ. Попробуйте снова.");
    } finally {
      setLoadingId(null);
    }
  };

  return (
    <section className="section" id="pricing">
      <div className="container">
        <h2 className="section-title">{t(locale, "pricing_title")}</h2>
        <p className="section-sub">{t(locale, "pricing_subtitle")}</p>

        {successMsg && (
          <div
            style={{
              maxWidth: 600,
              margin: "0 auto 20px auto",
              padding: "14px 18px",
              background: "rgba(16, 185, 129, 0.15)",
              border: "1px solid #10b981",
              borderRadius: 10,
              color: "#34d399",
              textAlign: "center",
              fontSize: 15,
              fontWeight: 500,
            }}
          >
            {successMsg}
          </div>
        )}

        {errorMsg && (
          <div
            style={{
              maxWidth: 600,
              margin: "0 auto 20px auto",
              padding: "14px 18px",
              background: "rgba(239, 68, 68, 0.15)",
              border: "1px solid #ef4444",
              borderRadius: 10,
              color: "#f87171",
              textAlign: "center",
              fontSize: 15,
            }}
          >
            {errorMsg}
          </div>
        )}

        <div className="pricing-grid">
          {packages.map((p) => {
            const badgeText = locale === "ru" ? p.badgeRu : p.badgeEn;
            const nameText = locale === "ru" ? p.nameRu : p.nameEn;
            const descText = locale === "ru" ? p.descRu : p.descEn;
            const isLoading = loadingId === p.id;

            return (
              <div className={"price-card" + (badgeText ? " featured" : "")} key={p.id}>
                {badgeText && <span className="badge">{badgeText}</span>}
                <h3>{nameText}</h3>
                <div className="credits">
                  {p.credits} <span>{t(locale, "credits_label")}</span>
                </div>
                <div className="desc">{descText}</div>
                <div className="price">
                  {p.price.toLocaleString("ru-RU")} ₽ <small>/ {t(locale, "per_gen")}</small>
                </div>
                <button
                  className="btn btn-primary"
                  style={{ width: "100%" }}
                  disabled={isLoading}
                  onClick={() => handleBuy(p)}
                >
                  {isLoading
                    ? locale === "ru"
                      ? "⏳ Оформление..."
                      : "⏳ Processing..."
                    : t(locale, "buy_label")}
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
