"use client";

import { useEffect, useState } from "react";
import { useLocale } from "./locale-context";
import { authHeaders } from "@/lib/client-auth";
import { ClientUser } from "./types";

export default function Account({ initialUser }: { initialUser: ClientUser }) {
  const { t, locale } = useLocale();
  const [user, setUser] = useState(initialUser);
  const [copied, setCopied] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [history, setHistory] = useState<any[]>([]);
  const [pubIds, setPubIds] = useState<Record<string, boolean>>({});
  const [refLink, setRefLink] = useState("");

  useEffect(() => {
    fetch("/api/auth/me", { headers: authHeaders() })
      .then((r) => r.json())
      .then((d) => d.user && setUser(d.user));
    fetch("/api/generations", { headers: authHeaders() })
      .then((r) => r.json())
      .then((d) => {
        const list = d.generations || [];
        setHistory(list);
        const map: Record<string, boolean> = {};
        list.forEach((g: any) => {
          if (g.id) map[g.id] = !!g.published;
        });
        setPubIds(map);
      });
  }, []);

  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 2600);
    return () => clearTimeout(id);
  }, [toast]);

  // Build the referral link only on the client (window is unavailable during SSR).
  useEffect(() => {
    if (typeof window !== "undefined") {
      setRefLink(`${window.location.origin}/register?ref=${user.referralCode}`);
    }
  }, [user.referralCode]);

  async function copyRef() {
    try {
      await navigator.clipboard.writeText(refLink);
      setCopied(true);
      setToast(t("account_copied"));
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback for browsers that disallow clipboard on insecure origins.
      try {
        const input = document.createElement("input");
        input.value = refLink;
        document.body.appendChild(input);
        input.select();
        document.execCommand("copy");
        document.body.removeChild(input);
        setCopied(true);
        setToast(t("account_copied"));
        setTimeout(() => setCopied(false), 2000);
      } catch {
        setToast(t("common_error"));
      }
    }
  }

  async function togglePublish(id: string) {
    const next = !pubIds[id];
    try {
      const res = await fetch(`/api/generations/${id}/publish`, {
        method: "POST",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ published: next }),
      });
      if (res.ok) setPubIds((p) => ({ ...p, [id]: next }));
    } catch {
      /* ignore */
    }
  }

  const tgGranted = user.telegramGranted;
  const vkGranted = user.vkGranted;

  return (
    <div className="container" style={{ paddingTop: 40, paddingBottom: 70 }}>
      <h1 style={{ fontSize: 30, fontWeight: 800 }}>{t("account_title")}</h1>
      <p className="muted" style={{ marginTop: 6 }}>{user.name} · {user.email}</p>

      <div className="row" style={{ alignItems: "center", gap: 14, flexWrap: "wrap", marginTop: 20 }}>
        <div className="panel" style={{ minWidth: 220 }}>
          <div className="small muted">{t("account_credits")}</div>
          <div style={{ fontSize: 42, fontWeight: 800, color: "var(--brand)" }}>{user.credits}</div>
        </div>
      </div>

      {/* Referral */}
      <div className="ref-box mt">
        <h2 style={{ fontSize: 19 }}>{t("account_referral_title")}</h2>
        <p className="muted small" style={{ marginTop: 6 }}>
          {t("account_referral_desc")} {t("account_invited", { n: user.referralCount })}
        </p>
        <div className="ref-link">
          <input className="input" readOnly value={refLink} onFocus={(e) => e.target.select()} />
          <button className="btn btn-primary" onClick={copyRef}>
            {copied ? "✓" : t("account_copy")}
          </button>
        </div>
      </div>

      {/* Rewards */}
      <p className="small muted mt">{t("rewards_not_configured")}</p>
      <div className="panel mt">
        <h2 style={{ fontSize: 19 }}>{t("rewards_title")}</h2>
        <p className="muted small" style={{ marginTop: 6 }}>{t("rewards_demo_note")}</p>
        <div className="rewards-grid mt">
          <div className="reward-card">
            <h3>✈️ {t("rewards_telegram")}</h3>
            <p>{t("rewards_telegram_desc")}</p>
            {tgGranted ? (
              <span className="chip" style={{ color: "var(--success)" }}>✓ {t("rewards_connected")}</span>
            ) : (
              <div className="row" style={{ flexWrap: "wrap" }}>
                <button className="btn btn-ghost btn-sm" disabled title={t("rewards_not_configured")}>
                  {t("rewards_connect")}
                </button>
              </div>
            )}
          </div>
          <div className="reward-card">
            <h3>💬 {t("rewards_vk")}</h3>
            <p>{t("rewards_vk_desc")}</p>
            {vkGranted ? (
              <span className="chip" style={{ color: "var(--success)" }}>✓ {t("rewards_connected")}</span>
            ) : (
              <div className="row" style={{ flexWrap: "wrap" }}>
                <button className="btn btn-ghost btn-sm" disabled title={t("rewards_not_configured")}>
                  {t("rewards_connect")}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* History */}
      <div className="panel mt">
        <h2 style={{ fontSize: 19 }}>{t("account_history")}</h2>
        {history.length === 0 ? (
          <p className="muted" style={{ marginTop: 12 }}>{t("common_loading")}</p>
        ) : (
          <div className="hist-list mt">
            {history.slice(0, 30).map((h) => (
              <div className="hist-item" key={h.id}>
                <img src={h.originalUrl} alt="" />
                <div className="grow">
                  <div style={{ fontWeight: 600 }}>{locale === "ru" ? h.styleNameRu : h.styleNameEn}</div>
                  <div className="small muted">
                    {new Date(h.createdAt).toLocaleString(locale === "ru" ? "ru-RU" : "en-US")} · {h.mode}
                  </div>
                </div>
                {h.resultUrl && h.status === "done" ? (
                  <button
                    className={"btn btn-sm " + (pubIds[h.id] ? "btn-ghost" : "")}
                    onClick={() => togglePublish(h.id)}
                  >
                    {pubIds[h.id] ? t("gallery_unpublish") : t("gallery_publish")}
                  </button>
                ) : (
                  <span className="chip">{h.status}</span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
