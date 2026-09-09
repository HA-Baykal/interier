"use client";

/**
 * Admin panel: users & manual credit grants.
 *
 * 1. Manually add generations by nickname (@username, name, email) — the path
 *    used when a user paid but the credits did not arrive.
 * 2. List all active bot users (messenger identity or bot-created account) with
 *    balance, designs count and last activity — plus one-click per-row grants.
 */

import { useCallback, useEffect, useState } from "react";
import { useLocale } from "./locale-context";
import { authHeaders } from "@/lib/client-auth";

type Platform = "telegram" | "vk" | "max";

type AdminUser = {
  id: string;
  name: string;
  email: string | null;
  nickname: string | null;
  handles: { telegram: string | null; vk: string | null; max: string | null };
  platforms: Platform[];
  credits: number;
  isAdmin: boolean;
  origin: string | null;
  isBot: boolean;
  createdAt: number;
  lastActiveAt: number | null;
  generations: number;
};

const PLATFORM_ICON: Record<Platform, string> = { telegram: "✈️", vk: "💬", max: "🟦" };

export default function AdminUsers() {
  const { t, locale } = useLocale();
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [botOnly, setBotOnly] = useState(true);
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [nickname, setNickname] = useState("");
  const [amount, setAmount] = useState("5");
  const [rowAmount, setRowAmount] = useState("5");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  const fmt = (ts: number) => new Date(ts).toLocaleString(locale === "ru" ? "ru-RU" : "en-US");

  const load = useCallback(
    async (q = search, onlyBot = botOnly) => {
      try {
        const params = new URLSearchParams();
        if (onlyBot) params.set("bot", "1");
        if (q.trim()) params.set("q", q.trim());
        const res = await fetch(`/api/admin/users?${params.toString()}`, { headers: authHeaders() });
        if (!res.ok) {
          setNotice({ kind: "err", text: t("admin_users_load_failed") });
          return;
        }
        const d = await res.json();
        setUsers(d.users || []);
      } catch {
        setNotice({ kind: "err", text: t("admin_users_load_failed") });
      }
    },
    [search, botOnly, t]
  );

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [botOnly]);

  async function grantByQuery() {
    const n = Number(amount);
    if (!Number.isInteger(n) || n < 1) {
      setNotice({ kind: "err", text: t("admin_credit_bad_amount") });
      return;
    }
    setBusy(true);
    setNotice(null);
    try {
      const res = await fetch("/api/admin/users", {
        method: "POST",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ query: nickname, amount: n }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok || !d.ok) {
        if (d.error === "multiple") {
          const list = (d.users || []).map((u: AdminUser) => u.nickname || u.name).join(", ");
          setNotice({ kind: "err", text: t("admin_credit_multiple", { list }) });
        } else if (d.error === "not_found") {
          setNotice({ kind: "err", text: t("admin_credit_not_found") });
        } else {
          setNotice({ kind: "err", text: t("common_error") });
        }
        return;
      }
      setNotice({ kind: "ok", text: t("admin_credit_done", { name: d.user.nickname || d.user.name, n: d.granted, credits: d.credits }) });
      await load();
    } catch {
      setNotice({ kind: "err", text: t("common_error") });
    } finally {
      setBusy(false);
    }
  }

  async function grantUser(userId: string) {
    const n = Number(rowAmount);
    if (!Number.isInteger(n) || n < 1) {
      setNotice({ kind: "err", text: t("admin_credit_bad_amount") });
      return;
    }
    setBusy(true);
    setNotice(null);
    try {
      const res = await fetch("/api/admin/users", {
        method: "POST",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ userId, amount: n }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok || !d.ok) {
        setNotice({ kind: "err", text: d.error === "not_found" ? t("admin_credit_not_found") : t("common_error") });
        return;
      }
      setNotice({ kind: "ok", text: t("admin_credit_done", { name: d.user.nickname || d.user.name, n: d.granted, credits: d.credits }) });
      await load();
    } catch {
      setNotice({ kind: "err", text: t("common_error") });
    } finally {
      setBusy(false);
    }
  }

  const date = (u: AdminUser) => fmt(u.lastActiveAt || u.createdAt);

  return (
    <div className="container" style={{ paddingTop: 20, paddingBottom: 40 }}>
      <div className="panel">
        <h2 style={{ fontSize: 19 }}>{t("admin_users_title")}</h2>
        <p className="muted small" style={{ marginTop: 6 }}>
          {t("admin_users_subtitle")}
        </p>
        {notice && (
          <div style={{ marginTop: 10 }}>
            {notice.kind === "ok" ? (
              <span className="ok" role="status">{notice.text}</span>
            ) : (
              <span className="err" role="alert">{notice.text}</span>
            )}
          </div>
        )}

        {/* Manual grant by nickname */}
        <div className="panel mt" style={{ background: "rgba(107,124,255,0.05)", borderColor: "var(--brand)" }}>
          <h3 style={{ fontSize: 16 }}>{t("admin_credit_title")}</h3>
          <p className="muted small" style={{ marginTop: 6 }}>{t("admin_credit_hint")}</p>
          <div className="row mt" style={{ flexWrap: "wrap", gap: 10 }}>
            <div className="field" style={{ flex: 2, minWidth: 240, margin: 0 }}>
              <label>{t("admin_credit_nickname")}</label>
              <input
                className="input"
                placeholder="@vektor_komforta38"
                value={nickname}
                onChange={(e) => setNickname(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") void grantByQuery(); }}
              />
            </div>
            <div className="field" style={{ flex: 1, minWidth: 140, margin: 0 }}>
              <label>{t("admin_credit_amount")}</label>
              <input className="input" type="number" min="1" value={amount} onChange={(e) => setAmount(e.target.value)} />
            </div>
            <button className="btn btn-primary" style={{ alignSelf: "flex-end" }} onClick={grantByQuery} disabled={busy}>
              {busy ? t("admin_credit_granting") : t("admin_credit_grant")}
            </button>
          </div>
        </div>

        {/* Active bot users */}
        <div className="row mt" style={{ justifyContent: "space-between", flexWrap: "wrap", gap: 10 }}>
          <div>
            <h3 style={{ fontSize: 17 }}>{t("admin_users_bot_title")}</h3>
            <p className="muted small" style={{ marginTop: 4 }}>{t("admin_users_bot_hint")}</p>
          </div>
          <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
            <div className="row" style={{ gap: 4 }}>
              <button className={`btn btn-sm ${botOnly ? "btn-primary" : "btn-ghost"}`} onClick={() => setBotOnly(true)}>
                {t("admin_users_bot_only")}
              </button>
              <button className={`btn btn-sm ${!botOnly ? "btn-primary" : "btn-ghost"}`} onClick={() => setBotOnly(false)}>
                {t("admin_users_all")}
              </button>
            </div>
            <div className="row" style={{ gap: 6 }}>
              <input
                className="input"
                style={{ minWidth: 210 }}
                placeholder={t("admin_users_search")}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { setSearch(query); load(query, botOnly); } }}
              />
              <button className="btn btn-sm" onClick={() => { setSearch(query); void load(query, botOnly); }}>
                🔍
              </button>
            </div>
            <div className="field" style={{ margin: 0, minWidth: 130 }}>
              <input className="input" type="number" min="1" value={rowAmount} onChange={(e) => setRowAmount(e.target.value)} title={t("admin_credit_amount")} />
            </div>
          </div>
        </div>

        {!users.length ? (
          <p className="muted small mt">{t("admin_users_empty")}</p>
        ) : (
          <div className="mt">
            {users.map((u) => (
              <div className="hist-item" key={u.id} style={{ flexWrap: "wrap", gap: 10 }}>
                <div className="grow" style={{ minWidth: 220 }}>
                  <div style={{ fontWeight: 600 }}>
                    {u.nickname || u.name}
                    {u.isAdmin ? " 👑" : ""}
                    <span className="small muted"> · {u.name}</span>
                  </div>
                  <div className="small muted">
                    {u.platforms.map((p) => PLATFORM_ICON[p] || "").join(" ") || "🌐"} {u.email || ""}
                    {" · "}
                    {t("admin_users_last_active")}: {date(u)}
                    {" · "}
                    {t("admin_users_designs")}: {u.generations}
                  </div>
                </div>
                <span className="chip" style={{ color: "var(--brand)" }}>{t("admin_users_balance")}: {u.credits} ✦</span>
                <button
                  className="btn btn-sm btn-primary"
                  disabled={busy}
                  onClick={() => grantUser(u.id)}
                  title={t("admin_credit_grant")}
                >
                  +{rowAmount} ✦
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
