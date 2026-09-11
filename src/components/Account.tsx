"use client";

import { useEffect, useState } from "react";
import { useLocale } from "./locale-context";
import { authHeaders } from "@/lib/client-auth";
import { ClientPackage, ClientUser } from "./types";
import TelegramAccess from "./TelegramAccess";

export default function Account({
  initialUser,
  packages = [],
}: {
  initialUser: ClientUser;
  packages?: ClientPackage[];
}) {
  const { t, locale } = useLocale();
  const [user, setUser] = useState(initialUser);
  const [copied, setCopied] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [history, setHistory] = useState<any[]>([]);
  const [pubIds, setPubIds] = useState<Record<string, boolean>>({});
  const [refLink, setRefLink] = useState("");
  const [buyingId, setBuyingId] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window !== "undefined" && window.location.search.includes("payment=success")) {
      setToast(locale === "ru" ? "🎉 Оплата прошла успешно! Баланс пополнен." : "🎉 Payment successful! Balance topped up.");
    }
  }, [locale]);

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

  async function handleBuy(pkg: ClientPackage) {
    setBuyingId(pkg.id);
    try {
      const res = await fetch("/api/payments/create", {
        method: "POST",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ packageId: pkg.id }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        throw new Error(data.message || data.error || "Ошибка создания заказа");
      }
      if (data.confirmationUrl) {
        window.location.href = data.confirmationUrl;
        return;
      }
      if (data.isTest) {
        setToast(
          locale === "ru"
            ? `🎉 Тестовая оплата прошла! Начислено +${data.creditsAdded || pkg.credits} генераций.`
            : `🎉 Test payment successful! Added +${data.creditsAdded || pkg.credits} credits.`
        );
        setUser((u) => ({ ...u, credits: u.credits + (data.creditsAdded || pkg.credits) }));
      }
    } catch (e: any) {
      setToast(e.message || "Не удалось создать заказ");
    } finally {
      setBuyingId(null);
    }
  }

  const tgGranted = user.telegramGranted;

  return (
    <div className="container" style={{ paddingTop: 40, paddingBottom: 70 }}>
      <h1 style={{ fontSize: 30, fontWeight: 800 }}>{t("account_title")}</h1>
      <p className="muted" style={{ marginTop: 6 }}>{user.name}{user.email ? ` · ${user.email}` : ""}</p>

      <div className="row" style={{ alignItems: "center", gap: 14, flexWrap: "wrap", marginTop: 20 }}>
        <div className="panel" style={{ minWidth: 220 }}>
          <div className="small muted">{t("account_credits")}</div>
          <div style={{ fontSize: 42, fontWeight: 800, color: "var(--brand)" }}>{user.credits}</div>
        </div>
      </div>

      {/* Packages / Top-up */}
      {packages.length > 0 && (
        <div className="panel mt">
          <h2 style={{ fontSize: 19 }}>💳 {locale === "ru" ? "Пополнить баланс генераций" : "Top up generation credits"}</h2>
          <p className="muted small" style={{ marginTop: 6 }}>
            {locale === "ru" ? "Выберите тарифный план для мгновенного начисления генераций." : "Choose a package for instant generation top-up."}
          </p>
          <div className="pricing-grid mt">
            {packages.filter((p) => p.active).map((p) => {
              const badgeText = locale === "ru" ? p.badgeRu : p.badgeEn;
              const isBuying = buyingId === p.id;
              return (
                <div className={"price-card" + (badgeText ? " featured" : "")} key={p.id}>
                  {badgeText && <span className="badge">{badgeText}</span>}
                  <h3>{locale === "ru" ? p.nameRu : p.nameEn}</h3>
                  <div className="credits">
                    {p.credits} <span>{t("credits_label")}</span>
                  </div>
                  <div className="desc">{locale === "ru" ? p.descRu : p.descEn}</div>
                  <div className="price">
                    {p.price.toLocaleString("ru-RU")} ₽ <small>/ {t("per_gen")}</small>
                  </div>
                  <button
                    className="btn btn-primary"
                    style={{ width: "100%" }}
                    disabled={isBuying}
                    onClick={() => handleBuy(p)}
                  >
                    {isBuying ? "⏳ …" : t("buy_label")}
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="panel mt">
        <h2 style={{ fontSize: 19 }}>{t("tg_account_title")}</h2>
        {user.telegramLinked ? <p className="ok mt">{t("tg_linked")}</p> : <>
          <p className="small muted mt">{t(user.isAdmin || user.verified ? "tg_link_help" : "tg_unverified_help")}</p>
          <TelegramAccess purpose={user.isAdmin || user.verified ? "link" : "login"} onLinked={() => {
            fetch("/api/auth/me", { headers: authHeaders(), cache: "no-store" }).then(r => r.json()).then(data => { if (data.user) setUser(data.user); });
          }} />
        </>}
      </div>

      {/* Referral */}
      <div className="ref-box mt">
        <h2 style={{ fontSize: 19 }}>{t("account_referral_title")}</h2>
        <p className="muted small" style={{ marginTop: 6 }}>
          {t("referrals_pending")} {t("account_invited", { n: user.referralCount })}
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
        </div>
      </div>

      {/* Messenger bot & mini app */}
      <BotLinkPanel />

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

function BotLinkPanel() {
  const { t, locale } = useLocale();
  const [info, setInfo] = useState<any | null>(null);
  const [link, setLink] = useState<Record<string, any>>({});
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/bots/info")
      .then((r) => r.json())
      .then(setInfo)
      .catch(() => {});
  }, []);

  async function connect(platform: string) {
    setBusy(platform);
    try {
      const res = await fetch("/api/account/botlink", {
        method: "POST",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ platform }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) setLink((l) => ({ ...l, [platform]: data }));
    } finally {
      setBusy(null);
    }
  }

  const platforms = (info?.platforms || []).filter((p: any) => p.connected);

  return (
    <div className="panel mt">
      <h2 style={{ fontSize: 19 }}>{t("account_bot_title")}</h2>
      <p className="muted small" style={{ marginTop: 6 }}>
        {t("account_bot_desc")}
      </p>

      {!platforms.length ? (
        <p className="small muted" style={{ marginTop: 12 }}>
          {t("account_bot_none")}
        </p>
      ) : (
        <div className="rewards-grid mt">
          {platforms.map((p: any) => (
            <div className="reward-card" key={p.platform}>
              <h3>
                ✈️ Telegram
                {p.username ? ` · @${String(p.username).replace(/^@/, "")}` : ""}
              </h3>
              <p className="small muted">{locale === "ru" ? "Дизайны, кредиты и история — общие с сайтом." : "Designs, credits and history are shared with the site."}</p>
              {link[p.platform]?.link ? (
                <div className="row" style={{ flexWrap: "wrap", gap: 8, marginTop: 6 }}>
                  <a className="btn btn-primary btn-sm" href={link[p.platform].link} target="_blank" rel="noreferrer">
                    {t("account_bot_open_start")}
                  </a>
                  <button
                    className="btn btn-ghost btn-sm"
                    onClick={() => void navigator.clipboard?.writeText(String(link[p.platform].code))}
                  >
                    {t("account_bot_copy_code")}
                  </button>
                </div>
              ) : (
                <button className="btn btn-ghost btn-sm" style={{ marginTop: 6 }} disabled={busy === p.platform} onClick={() => connect(p.platform)}>
                  {busy === p.platform ? "…" : t("account_bot_connect")}
                </button>
              )}
              {p.hasMiniApp && info?.appUrl && (
                <p className="small muted" style={{ marginTop: 8 }}>
                  <a href={info.appUrl} target="_blank" rel="noreferrer">
                    📱 {t("account_bot_app")}
                  </a>
                </p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
