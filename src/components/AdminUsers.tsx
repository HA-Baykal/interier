"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocale } from "./locale-context";
import { authHeaders } from "@/lib/client-auth";
import { AdminUserView, AdminUsersStats } from "@/lib/admin-users";

type FilterOrigin = "all" | "web" | "telegram" | "admin" | "with_credits" | "with_gens";
type SortOption = "newest" | "oldest" | "credits_desc" | "credits_asc" | "gens_desc" | "name_asc";

type ModalState = {
  user: AdminUserView;
  mode: "add" | "set";
  amount: number;
  resetTrial: boolean;
  isAdmin: boolean;
} | null;

export default function AdminUsers({
  initialUsers,
  initialStats,
}: {
  initialUsers?: AdminUserView[];
  initialStats?: AdminUsersStats;
}) {
  const { t, locale } = useLocale();

  const [users, setUsers] = useState<AdminUserView[]>(initialUsers || []);
  const [stats, setStats] = useState<AdminUsersStats>(
    initialStats || {
      total: initialUsers?.length || 0,
      web: 0,
      telegram: 0,
      admins: 0,
      totalCredits: 0,
      totalGenerations: 0,
    }
  );
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<FilterOrigin>("all");
  const [sort, setSort] = useState<SortOption>("newest");
  const [modal, setModal] = useState<ModalState>(null);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{ msg: string; type: "ok" | "err" } | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [quickBusyId, setQuickBusyId] = useState<string | null>(null);

  const showToast = useCallback((msg: string, type: "ok" | "err" = "ok") => {
    setToast({ msg, type });
    setTimeout(() => {
      setToast((prev) => (prev?.msg === msg ? null : prev));
    }, 3200);
  }, []);

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/users", {
        headers: authHeaders(),
        cache: "no-store",
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.ok) {
        setUsers(data.users || []);
        if (data.stats) setStats(data.stats);
      } else {
        showToast(data.message || data.error || t("admin_users_toast_error", { err: `HTTP ${res.status}` }), "err");
      }
    } catch (e) {
      showToast(e instanceof Error ? e.message : t("common_error"), "err");
    } finally {
      setLoading(false);
    }
  }, [showToast, t]);

  useEffect(() => {
    if (!initialUsers || initialUsers.length === 0) {
      fetchUsers();
    }
  }, [fetchUsers, initialUsers]);

  const copyUserId = useCallback(
    async (id: string) => {
      try {
        await navigator.clipboard.writeText(id);
        setCopiedId(id);
        showToast(t("admin_users_copied_id"), "ok");
        setTimeout(() => setCopiedId((curr) => (curr === id ? null : curr)), 1800);
      } catch {
        showToast(id, "ok");
      }
    },
    [showToast, t]
  );

  const applyQuickCredits = useCallback(
    async (user: AdminUserView, delta: number) => {
      setQuickBusyId(user.id);
      try {
        const res = await fetch("/api/admin/users", {
          method: "POST",
          headers: { ...authHeaders(), "Content-Type": "application/json" },
          body: JSON.stringify({ userId: user.id, delta }),
        });
        const data = await res.json().catch(() => ({}));
        if (res.ok && data.ok && data.user) {
          const updated: AdminUserView = data.user;
          setUsers((prev) => prev.map((u) => (u.id === updated.id ? updated : u)));
          setStats((prev) => ({
            ...prev,
            totalCredits: Math.max(0, prev.totalCredits + delta),
          }));
          showToast(
            t("admin_users_toast_success", {
              name: updated.name || updated.email || updated.id,
              credits: updated.credits,
            }),
            "ok"
          );
        } else {
          showToast(data.message || data.error || t("common_error"), "err");
        }
      } catch (e) {
        showToast(e instanceof Error ? e.message : t("common_error"), "err");
      } finally {
        setQuickBusyId(null);
      }
    },
    [showToast, t]
  );

  const saveModal = useCallback(async () => {
    if (!modal) return;
    setSaving(true);
    try {
      const payload: {
        userId: string;
        delta?: number;
        setCredits?: number;
        resetTrial?: boolean;
        setIsAdmin?: boolean;
      } = {
        userId: modal.user.id,
        resetTrial: modal.resetTrial,
        setIsAdmin: modal.isAdmin,
      };

      if (modal.mode === "set") {
        payload.setCredits = Math.max(0, modal.amount);
      } else {
        payload.delta = modal.amount;
      }

      const res = await fetch("/api/admin/users", {
        method: "POST",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.ok && data.user) {
        const updated: AdminUserView = data.user;
        setUsers((prev) => prev.map((u) => (u.id === updated.id ? updated : u)));
        showToast(
          t("admin_users_toast_success", {
            name: updated.name || updated.email || updated.id,
            credits: updated.credits,
          }),
          "ok"
        );
        setModal(null);
        fetchUsers();
      } else {
        showToast(data.message || data.error || t("common_error"), "err");
      }
    } catch (e) {
      showToast(e instanceof Error ? e.message : t("common_error"), "err");
    } finally {
      setSaving(false);
    }
  }, [fetchUsers, modal, showToast, t]);

  const filteredUsers = useMemo(() => {
    let result = [...users];

    if (filter === "web") {
      result = result.filter((u) => u.origin === "web");
    } else if (filter === "telegram") {
      result = result.filter((u) => u.origin === "telegram" || u.telegramLinked);
    } else if (filter === "admin") {
      result = result.filter((u) => u.isAdmin);
    } else if (filter === "with_credits") {
      result = result.filter((u) => u.credits > 0);
    } else if (filter === "with_gens") {
      result = result.filter((u) => u.generationsCount > 0);
    }

    const q = search.trim().toLowerCase();
    if (q) {
      result = result.filter((u) => {
        const nameMatch = u.name?.toLowerCase().includes(q);
        const emailMatch = u.email?.toLowerCase().includes(q);
        const idMatch = u.id?.toLowerCase().includes(q);
        const tgMatch = u.telegramUsername?.toLowerCase().includes(q) || String(u.telegramId || "").includes(q);
        const refMatch = u.referralCode?.toLowerCase().includes(q);
        return nameMatch || emailMatch || idMatch || tgMatch || refMatch;
      });
    }

    result.sort((a, b) => {
      switch (sort) {
        case "newest":
          return b.createdAt - a.createdAt;
        case "oldest":
          return a.createdAt - b.createdAt;
        case "credits_desc":
          return b.credits - a.credits;
        case "credits_asc":
          return a.credits - b.credits;
        case "gens_desc":
          return b.generationsCount - a.generationsCount;
        case "name_asc":
          return (a.name || a.email || "").localeCompare(b.name || b.email || "");
        default:
          return b.createdAt - a.createdAt;
      }
    });

    return result;
  }, [users, filter, search, sort]);

  const originBadge = (origin: string) => {
    if (origin === "telegram") {
      return <span className="chip chip-tg" title={t("admin_users_origin_telegram")}>✈️ Telegram</span>;
    }
    return <span className="chip chip-web" title={t("admin_users_origin_web")}>🌐 {t("admin_users_origin_web")}</span>;
  };

  return (
    <div className="panel mt admin-users-section">
      <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 12 }}>
        <div>
          <h2 style={{ fontSize: 22, display: "flex", alignItems: "center", gap: 10 }}>
            <span>{t("admin_users_title")}</span>
            <span className="chip" style={{ fontSize: 13, padding: "3px 10px", background: "rgba(107,124,255,0.15)", color: "var(--brand)" }}>
              {stats.total}
            </span>
          </h2>
          <p className="muted small" style={{ marginTop: 6, maxWidth: 700 }}>
            {t("admin_users_subtitle")}
          </p>
        </div>
        <button
          className="btn btn-sm btn-ghost"
          onClick={fetchUsers}
          disabled={loading}
          style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
        >
          <span style={{ display: "inline-block", transform: loading ? "rotate(360deg)" : "none", transition: "transform 0.5s" }}>
            ↺
          </span>
          {t("admin_users_reload")}
        </button>
      </div>

      {/* Summary statistics */}
      <div className="admin-grid mt" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))" }}>
        <div className="stat-card" style={{ padding: "12px 14px" }}>
          <div className="k">{t("admin_users_stat_total")}</div>
          <div className="v" style={{ fontSize: 24 }}>{stats.total}</div>
        </div>
        <div className="stat-card" style={{ padding: "12px 14px" }}>
          <div className="k">{t("admin_users_stat_web")}</div>
          <div className="v" style={{ fontSize: 24, color: "#6b7cff" }}>{stats.web}</div>
        </div>
        <div className="stat-card" style={{ padding: "12px 14px" }}>
          <div className="k">{t("admin_users_stat_telegram")}</div>
          <div className="v" style={{ fontSize: 24, color: "#2ea5ff" }}>{stats.telegram}</div>
        </div>
        <div className="stat-card" style={{ padding: "12px 14px" }}>
          <div className="k">{t("admin_users_stat_total_credits")}</div>
          <div className="v" style={{ fontSize: 24, color: "var(--brand-2)" }}>{stats.totalCredits} ⚡</div>
        </div>
        <div className="stat-card" style={{ padding: "12px 14px" }}>
          <div className="k">{t("admin_users_stat_total_gens")}</div>
          <div className="v" style={{ fontSize: 24 }}>{stats.totalGenerations} 🎨</div>
        </div>
      </div>

      {/* Filters and Search toolbar */}
      <div className="mt" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div className="row" style={{ gap: 12, flexWrap: "wrap" }}>
          <div style={{ flex: "2 1 280px", position: "relative" }}>
            <input
              className="input"
              style={{ width: "100%", paddingLeft: 36 }}
              placeholder={t("admin_users_search_placeholder")}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <span style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", opacity: 0.5, pointerEvents: "none" }}>
              🔍
            </span>
            {search && (
              <button
                onClick={() => setSearch("")}
                style={{
                  position: "absolute",
                  right: 10,
                  top: "50%",
                  transform: "translateY(-50%)",
                  background: "transparent",
                  border: "none",
                  color: "var(--text-dim)",
                  padding: "4px 8px",
                  fontSize: 14,
                }}
              >
                ✕
              </button>
            )}
          </div>

          <div style={{ flex: "1 1 200px" }}>
            <select className="input" style={{ width: "100%" }} value={sort} onChange={(e) => setSort(e.target.value as SortOption)}>
              <option value="newest">🕒 {t("admin_users_sort_newest")}</option>
              <option value="oldest">⏳ {t("admin_users_sort_oldest")}</option>
              <option value="credits_desc">⚡ {t("admin_users_sort_credits_desc")}</option>
              <option value="credits_asc">⚡ {t("admin_users_sort_credits_asc")}</option>
              <option value="gens_desc">🎨 {t("admin_users_sort_gens_desc")}</option>
              <option value="name_asc">🔤 {t("admin_users_sort_name_asc")}</option>
            </select>
          </div>
        </div>

        {/* Filter chips */}
        <div className="row" style={{ gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <button
            className={`btn btn-sm ${filter === "all" ? "btn-primary" : "btn-ghost"}`}
            style={{ borderRadius: 999, padding: "5px 14px" }}
            onClick={() => setFilter("all")}
          >
            {t("admin_users_filter_all")} <span style={{ opacity: 0.75, marginLeft: 4 }}>({users.length})</span>
          </button>
          <button
            className={`btn btn-sm ${filter === "web" ? "btn-primary" : "btn-ghost"}`}
            style={{ borderRadius: 999, padding: "5px 14px" }}
            onClick={() => setFilter("web")}
          >
            {t("admin_users_filter_web")} <span style={{ opacity: 0.75, marginLeft: 4 }}>({stats.web})</span>
          </button>
          <button
            className={`btn btn-sm ${filter === "telegram" ? "btn-primary" : "btn-ghost"}`}
            style={{ borderRadius: 999, padding: "5px 14px" }}
            onClick={() => setFilter("telegram")}
          >
            {t("admin_users_filter_telegram")} <span style={{ opacity: 0.75, marginLeft: 4 }}>({stats.telegram})</span>
          </button>
          <button
            className={`btn btn-sm ${filter === "admin" ? "btn-primary" : "btn-ghost"}`}
            style={{ borderRadius: 999, padding: "5px 14px" }}
            onClick={() => setFilter("admin")}
          >
            {t("admin_users_filter_admins")} <span style={{ opacity: 0.75, marginLeft: 4 }}>({stats.admins})</span>
          </button>
          <button
            className={`btn btn-sm ${filter === "with_credits" ? "btn-primary" : "btn-ghost"}`}
            style={{ borderRadius: 999, padding: "5px 14px" }}
            onClick={() => setFilter("with_credits")}
          >
            {t("admin_users_filter_with_credits")}
          </button>
          <button
            className={`btn btn-sm ${filter === "with_gens" ? "btn-primary" : "btn-ghost"}`}
            style={{ borderRadius: 999, padding: "5px 14px" }}
            onClick={() => setFilter("with_gens")}
          >
            {t("admin_users_filter_with_gens")}
          </button>
        </div>
      </div>

      {/* User list */}
      <div className="mt" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {filteredUsers.length === 0 ? (
          <div className="panel" style={{ textAlign: "center", padding: "40px 20px", background: "rgba(255,255,255,0.02)" }}>
            <p className="muted" style={{ fontSize: 16 }}>{t("admin_users_empty")}</p>
          </div>
        ) : (
          filteredUsers.map((u) => {
            const isQuickBusy = quickBusyId === u.id;
            const formattedDate = new Date(u.createdAt).toLocaleString(locale === "ru" ? "ru-RU" : "en-US", {
              day: "2-digit",
              month: "2-digit",
              year: "numeric",
              hour: "2-digit",
              minute: "2-digit",
            });

            return (
              <div
                key={u.id}
                className="user-admin-card"
                style={{
                  background: "var(--bg-elev)",
                  border: "1px solid var(--border)",
                  borderRadius: "var(--radius-sm)",
                  padding: 16,
                  display: "flex",
                  flexDirection: "column",
                  gap: 12,
                  transition: "border-color 0.2s, background 0.2s",
                }}
              >
                {/* Top row: Identity & Badges */}
                <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 10 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                    <div
                      style={{
                        width: 42,
                        height: 42,
                        borderRadius: "50%",
                        background: u.isAdmin
                          ? "linear-gradient(135deg, #ffd166, #ff9f1c)"
                          : u.origin === "telegram"
                          ? "linear-gradient(135deg, #2ea5ff, #0088cc)"
                          : "linear-gradient(135deg, var(--brand), var(--brand-2))",
                        display: "grid",
                        placeItems: "center",
                        fontWeight: 800,
                        fontSize: 16,
                        color: u.isAdmin ? "#1a1e29" : "#fff",
                        flexShrink: 0,
                      }}
                    >
                      {u.isAdmin ? "👑" : (u.name || u.email || "U").slice(0, 1).toUpperCase()}
                    </div>

                    <div>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                        <span style={{ fontWeight: 700, fontSize: 16 }}>{u.name || "Пользователь"}</span>
                        {u.isAdmin && (
                          <span className="chip" style={{ background: "rgba(255,209,102,0.15)", color: "var(--warn)", borderColor: "rgba(255,209,102,0.3)" }}>
                            👑 {t("admin_users_role_admin")}
                          </span>
                        )}
                        {originBadge(u.origin)}
                      </div>

                      <div className="small muted" style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4, flexWrap: "wrap" }}>
                        <span>{u.email || t("admin_users_no_email")}</span>
                        <span>•</span>
                        <span
                          onClick={() => copyUserId(u.id)}
                          style={{ cursor: "pointer", textDecoration: "underline", opacity: 0.8 }}
                          title="Нажмите, чтобы скопировать ID"
                        >
                          ID: {u.id.slice(0, 14)}… {copiedId === u.id ? "✓" : "📋"}
                        </span>
                        <span>•</span>
                        <span>{t("admin_users_registered_at", { date: formattedDate })}</span>
                      </div>
                    </div>
                  </div>

                  {/* Balance / Generations status */}
                  <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                    <div
                      style={{
                        padding: "6px 14px",
                        borderRadius: 10,
                        background: u.credits > 0 ? "rgba(107,124,255,0.14)" : "rgba(255,255,255,0.05)",
                        border: u.credits > 0 ? "1px solid rgba(107,124,255,0.35)" : "1px solid var(--border)",
                        textAlign: "center",
                      }}
                    >
                      <div className="small muted" style={{ fontSize: 11 }}>{t("account_credits")}</div>
                      <div style={{ fontSize: 20, fontWeight: 800, color: u.credits > 0 ? "var(--brand)" : "var(--text-dim)" }}>
                        {u.credits} ⚡
                      </div>
                    </div>

                    <div
                      style={{
                        padding: "6px 12px",
                        borderRadius: 10,
                        background: "rgba(255,255,255,0.03)",
                        border: "1px solid var(--border)",
                        textAlign: "center",
                      }}
                      title={t("admin_users_gens_details", {
                        web: u.generationsByOrigin.web,
                        tg: u.generationsByOrigin.telegram,
                      })}
                    >
                      <div className="small muted" style={{ fontSize: 11 }}>{t("admin_stats_generations")}</div>
                      <div style={{ fontSize: 20, fontWeight: 800 }}>
                        {u.generationsCount} 🎨
                      </div>
                    </div>
                  </div>
                </div>

                {/* Second row: Messengers, Trial, Referrals */}
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    flexWrap: "wrap",
                    gap: 10,
                    paddingTop: 8,
                    borderTop: "1px solid rgba(255,255,255,0.05)",
                    fontSize: 13,
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                    {/* Trial status */}
                    <span
                      className="chip"
                      style={{
                        color: !u.trialUsed ? "var(--success)" : "var(--text-faint)",
                        background: !u.trialUsed ? "rgba(61,220,151,0.1)" : "transparent",
                      }}
                    >
                      {!u.trialUsed ? `✓ ${t("admin_users_trial_available")}` : `✗ ${t("admin_users_trial_used")}`}
                    </span>

                    {/* Linked messenger */}
                    {u.telegramId && (
                      <span className="chip" style={{ color: "#2ea5ff" }}>
                        ✈️ {u.telegramUsername ? `@${u.telegramUsername}` : `TG:${u.telegramId}`}
                      </span>
                    )}

                    {/* Referral info */}
                    <span className="small muted">
                      {t("admin_users_ref_code", { code: u.referralCode })} · {t("admin_users_invited_count", { n: u.referralCount })}
                    </span>
                  </div>

                  {/* Actions & Quick Add menu */}
                  <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                    <span className="small muted" style={{ marginRight: 2 }}>{t("admin_users_btn_quick_add", { n: "" })}:</span>
                    <button
                      className="btn btn-sm btn-ghost"
                      style={{ padding: "4px 8px", minWidth: 34 }}
                      disabled={isQuickBusy}
                      onClick={() => applyQuickCredits(u, 1)}
                      title="Начислить +1 генерацию"
                    >
                      +1
                    </button>
                    <button
                      className="btn btn-sm btn-ghost"
                      style={{ padding: "4px 8px", minWidth: 34 }}
                      disabled={isQuickBusy}
                      onClick={() => applyQuickCredits(u, 5)}
                      title="Начислить +5 генераций"
                    >
                      +5
                    </button>
                    <button
                      className="btn btn-sm btn-ghost"
                      style={{ padding: "4px 8px", minWidth: 34 }}
                      disabled={isQuickBusy}
                      onClick={() => applyQuickCredits(u, 10)}
                      title="Начислить +10 генераций"
                    >
                      +10
                    </button>

                    <button
                      className="btn btn-sm btn-primary"
                      style={{ padding: "5px 12px", marginLeft: 4 }}
                      onClick={() =>
                        setModal({
                          user: u,
                          mode: "add",
                          amount: 10,
                          resetTrial: false,
                          isAdmin: u.isAdmin,
                        })
                      }
                    >
                      {t("admin_users_btn_add_credits")}
                    </button>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Credit adjustment modal */}
      {modal && (
        <div
          className="modal-backdrop"
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.8)",
            zIndex: 9999,
            display: "grid",
            placeItems: "center",
            padding: 16,
            backdropFilter: "blur(6px)",
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget && !saving) setModal(null);
          }}
        >
          <div
            className="panel modal-dialog"
            style={{
              width: "100%",
              maxWidth: 500,
              background: "var(--bg-elev-2)",
              borderColor: "var(--brand)",
              boxShadow: "0 20px 60px rgba(0,0,0,0.6)",
              borderRadius: "var(--radius)",
            }}
          >
            <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
              <h2 style={{ fontSize: 20 }}>{t("admin_users_modal_title")}</h2>
              <button
                className="btn btn-sm btn-ghost"
                onClick={() => setModal(null)}
                disabled={saving}
                style={{ padding: "4px 10px" }}
              >
                ✕
              </button>
            </div>

            <p className="muted small" style={{ marginTop: 6 }}>
              {t("admin_users_modal_subtitle", {
                name: modal.user.name || modal.user.email || modal.user.id,
                credits: modal.user.credits,
              })}
            </p>

            {/* Mode switch: Add / Set */}
            <div className="row mt" style={{ gap: 8, background: "rgba(0,0,0,0.25)", padding: 4, borderRadius: 10 }}>
              <button
                className={`btn btn-sm ${modal.mode === "add" ? "btn-primary" : "btn-ghost"}`}
                style={{ flex: 1, borderRadius: 8 }}
                onClick={() => setModal((m) => m && { ...m, mode: "add", amount: 10 })}
              >
                ➕ Добавить / списать (+/-)
              </button>
              <button
                className={`btn btn-sm ${modal.mode === "set" ? "btn-primary" : "btn-ghost"}`}
                style={{ flex: 1, borderRadius: 8 }}
                onClick={() => setModal((m) => m && { ...m, mode: "set", amount: modal.user.credits })}
              >
                🎯 Установить точный баланс
              </button>
            </div>

            {/* Quick preset buttons */}
            {modal.mode === "add" ? (
              <div className="mt">
                <div className="small muted" style={{ marginBottom: 6 }}>{t("admin_users_modal_quick_header")}</div>
                <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
                  {[1, 5, 10, 25, 50, 100].map((n) => (
                    <button
                      key={n}
                      type="button"
                      className="btn btn-sm btn-ghost"
                      style={{ padding: "4px 10px", borderColor: modal.amount === n ? "var(--brand)" : undefined }}
                      onClick={() => setModal((m) => m && { ...m, amount: n })}
                    >
                      +{n}
                    </button>
                  ))}
                  {[-1, -5, -10].map((n) => (
                    <button
                      key={n}
                      type="button"
                      className="btn btn-sm btn-ghost"
                      style={{ padding: "4px 10px", color: "var(--danger)" }}
                      onClick={() => setModal((m) => m && { ...m, amount: n })}
                    >
                      {n}
                    </button>
                  ))}
                </div>

                <div className="field mt">
                  <label>{t("admin_users_modal_delta_label")}</label>
                  <input
                    className="input"
                    type="number"
                    value={modal.amount}
                    onChange={(e) => {
                      const val = Number(e.target.value);
                      setModal((m) => m && { ...m, amount: isNaN(val) ? 0 : val });
                    }}
                    placeholder={t("admin_users_modal_delta_placeholder")}
                  />
                  <p className="small muted" style={{ marginTop: 4 }}>
                    Итоговый баланс станет: <b>{Math.max(0, modal.user.credits + modal.amount)} ⚡</b>
                  </p>
                </div>
              </div>
            ) : (
              <div className="field mt">
                <label>{t("admin_users_modal_set_label")}</label>
                <input
                  className="input"
                  type="number"
                  min="0"
                  value={modal.amount}
                  onChange={(e) => {
                    const val = Number(e.target.value);
                    setModal((m) => m && { ...m, amount: isNaN(val) ? 0 : Math.max(0, val) });
                  }}
                  placeholder={t("admin_users_modal_set_placeholder")}
                />
                <p className="small muted" style={{ marginTop: 4 }}>
                  Текущий баланс <b>{modal.user.credits}</b> будет заменён на <b>{modal.amount} ⚡</b>
                </p>
              </div>
            )}

            {/* Extra toggles */}
            <div className="mt" style={{ display: "flex", flexDirection: "column", gap: 10, paddingTop: 10, borderTop: "1px solid var(--border)" }}>
              <label style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer", fontSize: 14 }}>
                <input
                  type="checkbox"
                  checked={modal.resetTrial}
                  onChange={(e) => setModal((m) => m && { ...m, resetTrial: e.target.checked })}
                />
                <span>{t("admin_users_modal_reset_trial")}</span>
              </label>

              <label style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer", fontSize: 14 }}>
                <input
                  type="checkbox"
                  checked={modal.isAdmin}
                  onChange={(e) => setModal((m) => m && { ...m, isAdmin: e.target.checked })}
                />
                <span>{t("admin_users_modal_is_admin")}</span>
              </label>
            </div>

            {/* Dialog action buttons */}
            <div className="row mt" style={{ justifyContent: "flex-end", gap: 10, marginTop: 20 }}>
              <button className="btn btn-ghost" onClick={() => setModal(null)} disabled={saving}>
                {t("admin_users_modal_cancel")}
              </button>
              <button className="btn btn-primary" onClick={saveModal} disabled={saving}>
                {saving ? "Сохраняем…" : t("admin_users_modal_save")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toast notifications */}
      {toast && (
        <div
          className="toast"
          style={{
            borderColor: toast.type === "err" ? "var(--danger)" : "var(--brand)",
            background: toast.type === "err" ? "rgba(40,15,15,0.95)" : "rgba(18,21,29,0.95)",
          }}
        >
          {toast.msg}
        </div>
      )}
    </div>
  );
}
