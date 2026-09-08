"use client";

/**
 * Price list editor.
 *
 * The owner changes prices, bundle sizes and wording here — no code, no
 * redeploy. Payments are not connected yet, so a package is a promise shown on
 * the site, in the mini app and in the bot; that is why every field is editable
 * and a switched-off package stays visible in the panel (but not on the site).
 */

import { useCallback, useEffect, useState } from "react";
import { useLocale } from "./locale-context";
import { authHeaders } from "@/lib/client-auth";

type Pkg = {
  id: string;
  slug: string;
  nameRu: string;
  nameEn: string;
  descRu: string;
  descEn: string;
  credits: number;
  price: number;
  badgeRu: string | null;
  badgeEn: string | null;
  active: boolean;
};

const EMPTY: Omit<Pkg, "id" | "slug"> = {
  nameRu: "",
  nameEn: "",
  descRu: "",
  descEn: "",
  credits: 5,
  price: 490,
  badgeRu: null,
  badgeEn: null,
  active: true,
};

export default function AdminPackages() {
  const { t } = useLocale();
  const [items, setItems] = useState<Pkg[]>([]);
  const [drafts, setDrafts] = useState<Record<string, Partial<Pkg>>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [fresh, setFresh] = useState({ ...EMPTY });

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/packages", { headers: authHeaders(), cache: "no-store" });
      if (!res.ok) {
        setErr(t("common_error"));
        return;
      }
      const data = await res.json();
      setItems(data.packages || []);
      setDrafts({});
    } catch {
      setErr(t("common_error"));
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  const draftOf = (p: Pkg): Pkg => ({ ...p, ...(drafts[p.id] || {}) });

  function set(id: string, patch: Partial<Pkg>) {
    setDrafts((d) => ({ ...d, [id]: { ...d[id], ...patch } }));
  }

  async function save(p: Pkg) {
    const draft = draftOf(p);
    setBusy(p.id);
    setErr(null);
    setMsg(null);
    try {
      const res = await fetch(`/api/admin/packages/${p.id}`, {
        method: "PATCH",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({
          nameRu: draft.nameRu,
          nameEn: draft.nameEn,
          descRu: draft.descRu,
          descEn: draft.descEn,
          credits: Number(draft.credits),
          price: Number(draft.price),
          badgeRu: draft.badgeRu || null,
          badgeEn: draft.badgeEn || null,
          active: draft.active,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setMsg(t("admin_pkg_saved"));
      await load();
      setTimeout(() => setMsg(null), 2500);
    } catch (e) {
      setErr(e instanceof Error ? e.message : t("common_error"));
    } finally {
      setBusy(null);
    }
  }

  async function toggle(p: Pkg) {
    const draft = draftOf(p);
    setBusy(p.id);
    try {
      await fetch(`/api/admin/packages/${p.id}`, {
        method: "PATCH",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ active: !draft.active }),
      });
      await load();
    } finally {
      setBusy(null);
    }
  }

  async function remove(p: Pkg) {
    if (!confirm(t("admin_pkg_confirm_delete", { name: draftOf(p).nameRu || p.slug }))) return;
    setBusy(p.id);
    try {
      await fetch(`/api/admin/packages/${p.id}`, { method: "DELETE", headers: authHeaders() });
      await load();
    } finally {
      setBusy(null);
    }
  }

  async function create() {
    setBusy("new");
    setErr(null);
    try {
      const res = await fetch("/api/admin/packages", {
        method: "POST",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ ...fresh, credits: Number(fresh.credits), price: Number(fresh.price) }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error === "slug_taken" ? t("admin_pkg_slug_taken") : data.error || `HTTP ${res.status}`);
      setAdding(false);
      setFresh({ ...EMPTY });
      setMsg(t("admin_pkg_saved"));
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : t("common_error"));
    } finally {
      setBusy(null);
    }
  }

  const field = (label: string, hint?: string) => (
    <>
      <label>{label}</label>
      {hint && <div className="small muted" style={{ marginTop: 2 }}>{hint}</div>}
    </>
  );

  const editor = (
    id: string,
    value: { nameRu: string; nameEn: string; descRu: string; descEn: string; credits: number; price: number; badgeRu: string | null; badgeEn: string | null; active: boolean },
    onChange: (patch: Record<string, unknown>) => void
  ) => (
    <div className="admin-grid" style={{ gap: 12, marginTop: 10 }}>
      <div className="field">
        {field(t("admin_pkg_name_ru"))}
        <input className="input" value={value.nameRu} onChange={(e) => onChange({ nameRu: e.target.value })} />
      </div>
      <div className="field">
        {field(t("admin_pkg_name_en"))}
        <input className="input" value={value.nameEn} onChange={(e) => onChange({ nameEn: e.target.value })} />
      </div>
      <div className="field">
        {field(t("admin_pkg_credits"), t("admin_pkg_credits_hint"))}
        <input className="input" type="number" min={1} value={value.credits} onChange={(e) => onChange({ credits: e.target.value })} />
      </div>
      <div className="field">
        {field(t("admin_pkg_price"), t("admin_pkg_price_hint"))}
        <input className="input" type="number" min={0} step="1" value={value.price} onChange={(e) => onChange({ price: e.target.value })} />
      </div>
      <div className="field">
        {field(t("admin_pkg_desc_ru"))}
        <textarea className="input" rows={2} value={value.descRu} onChange={(e) => onChange({ descRu: e.target.value })} />
      </div>
      <div className="field">
        {field(t("admin_pkg_desc_en"))}
        <textarea className="input" rows={2} value={value.descEn} onChange={(e) => onChange({ descEn: e.target.value })} />
      </div>
      <div className="field">
        {field(t("admin_pkg_badge_ru"))}
        <input className="input" value={value.badgeRu || ""} placeholder={t("admin_pkg_badge_ph")} onChange={(e) => onChange({ badgeRu: e.target.value })} />
      </div>
      <div className="field">
        {field(t("admin_pkg_badge_en"))}
        <input className="input" value={value.badgeEn || ""} placeholder="Popular" onChange={(e) => onChange({ badgeEn: e.target.value })} />
      </div>
    </div>
  );

  return (
    <div className="panel mt" id="admin-packages">
      <div className="row" style={{ justifyContent: "space-between", flexWrap: "wrap", gap: 10 }}>
        <div>
          <h2 style={{ fontSize: 19 }}>💳 {t("admin_pkg_title")}</h2>
          <p className="muted small" style={{ marginTop: 6 }}>{t("admin_pkg_subtitle")}</p>
        </div>
        <div className="row" style={{ gap: 8 }}>
          <button className="btn btn-sm btn-ghost" onClick={load} disabled={!!busy}>🔄 {t("admin_bots_reload")}</button>
          <button className="btn btn-sm" onClick={() => setAdding((v) => !v)} disabled={!!busy}>+ {t("admin_pkg_add")}</button>
        </div>
      </div>

      {msg && <div className="ok" style={{ marginTop: 10 }}>{msg}</div>}
      {err && <div className="err" style={{ marginTop: 10 }}>{err}</div>}

      {adding && (
        <div className="panel mt">
          <h3 style={{ fontSize: 16 }}>{t("admin_pkg_new")}</h3>
          {editor("new", fresh, (patch) => setFresh((f) => ({ ...f, ...patch })))}
          <div className="row mt" style={{ gap: 8 }}>
            <button className="btn btn-primary btn-sm" onClick={create} disabled={busy === "new" || !fresh.nameRu.trim()}>
              {t("admin_pkg_create")}
            </button>
            <button className="btn btn-ghost btn-sm" onClick={() => setAdding(false)}>{t("common_cancel")}</button>
          </div>
        </div>
      )}

      {!items.length && <p className="muted small mt">{t("admin_pkg_empty")}</p>}

      {items.map((p) => {
        const draft = draftOf(p);
        const dirty = JSON.stringify(draft) !== JSON.stringify(p);
        return (
          <div className="panel mt" key={p.id} style={{ opacity: draft.active ? 1 : 0.65 }}>
            <div className="row" style={{ justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
              <div>
                <b>{draft.nameRu || p.slug}</b> <span className="small muted">({p.slug})</span>
                <div className="small muted">
                  {draft.credits} {t("credits_label")} · {draft.price} ₽ · {draft.active ? t("admin_pkg_shown") : t("admin_pkg_hidden")}
                </div>
              </div>
              <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
                <button className="btn btn-sm btn-ghost" onClick={() => toggle(p)} disabled={busy === p.id}>
                  {draft.active ? t("admin_pkg_hide") : t("admin_pkg_show")}
                </button>
                <button className="btn btn-sm btn-primary" onClick={() => save(p)} disabled={busy === p.id || !dirty}>
                  {t("admin_save")}
                </button>
                <button className="btn btn-sm btn-danger" onClick={() => remove(p)} disabled={busy === p.id}>✕</button>
              </div>
            </div>
            {editor(p.id, draft, (patch) => set(p.id, patch))}
          </div>
        );
      })}
    </div>
  );
}
