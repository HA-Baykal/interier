"use client";

/**
 * Admin panel: the shopping list of interior details.
 *
 * Controls how a generated design is turned into «where to buy» links: which
 * marketplaces are allowed, how many items to extract, whether the AI tagger
 * draws hover hotspots, whether the list is shown in the public gallery, and
 * the partner/UTM parameters appended to every outgoing link (monetisation).
 */

import { useCallback, useEffect, useState } from "react";
import { useLocale } from "./locale-context";
import { authHeaders } from "@/lib/client-auth";

type Market = { id: string; label: string; short: string; emoji: string; strengths?: string[] };
type Category = { id: string; ru: string; en: string; emoji: string };

export default function AdminShopping() {
  const { t, locale } = useLocale();
  const [form, setForm] = useState<Record<string, string>>({});
  const [markets, setMarkets] = useState<Market[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [s, m] = await Promise.all([
        fetch("/api/admin/settings", { headers: authHeaders() }).then((r) => r.json()),
        fetch("/api/marketplaces").then((r) => r.json()),
      ]);
      setForm(s.settings || {});
      setMarkets(m.all || []);
      setCategories(m.categories || []);
    } catch {
      setErr(t("common_error"));
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  function set(key: string, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  const enabledMarkets = (form.shopping_marketplaces || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  function toggleMarket(id: string) {
    const next = enabledMarkets.includes(id) ? enabledMarkets.filter((m) => m !== id) : [...markets.map((m) => m.id).filter((m) => enabledMarkets.includes(m) || m === id)];
    set("shopping_marketplaces", next.join(","));
  }

  async function save() {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch("/api/admin/settings", {
        method: "PUT",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (!res.ok) {
        setErr(t("common_error"));
        return;
      }
      setMsg(t("admin_saved"));
      setTimeout(() => setMsg(null), 2500);
    } catch {
      setErr(t("common_error"));
    } finally {
      setBusy(false);
    }
  }

  const check = (key: string) => form[key] === "1" || form[key] === "true";
  const toggle = (key: string, on: boolean) => set(key, on ? "1" : "0");

  return (
    <div className="container" style={{ paddingTop: 20, paddingBottom: 40 }}>
      <div className="panel">
        <div className="row" style={{ justifyContent: "space-between", flexWrap: "wrap", gap: 10 }}>
          <div>
            <h2 style={{ fontSize: 19 }}>🛒 {t("admin_shop_title")}</h2>
            <p className="muted small" style={{ marginTop: 6 }}>
              {t("admin_shop_subtitle")}
            </p>
          </div>
          <button className="btn btn-sm btn-primary" onClick={save} disabled={busy}>
            {t("admin_save")}
          </button>
        </div>
        {msg && <div className="ok" style={{ marginTop: 10 }}>{msg}</div>}
        {err && <div className="err" style={{ marginTop: 10 }}>{err}</div>}
      </div>

      <div className="panel mt">
        <div className="row" style={{ flexWrap: "wrap", gap: 18 }}>
          <label className="row" style={{ gap: 10, cursor: "pointer" }}>
            <input type="checkbox" style={{ width: 18, height: 18 }} checked={check("shopping_enabled")} onChange={(e) => toggle("shopping_enabled", e.target.checked)} />
            {t("admin_shop_enabled")}
          </label>
          <label className="row" style={{ gap: 10, cursor: "pointer" }}>
            <input type="checkbox" style={{ width: 18, height: 18 }} checked={check("shopping_auto")} onChange={(e) => toggle("shopping_auto", e.target.checked)} />
            {t("admin_shop_auto")}
          </label>
          <label className="row" style={{ gap: 10, cursor: "pointer" }}>
            <input
              type="checkbox"
              style={{ width: 18, height: 18 }}
              checked={check("shopping_public_links")}
              onChange={(e) => toggle("shopping_public_links", e.target.checked)}
            />
            {t("admin_shop_public")}
          </label>
        </div>

        <div className="admin-grid mt">
          <div className="field">
            <label>{t("admin_shop_max_items")}</label>
            <input className="input" type="number" min={3} max={16} value={form.shopping_max_items || "8"} onChange={(e) => set("shopping_max_items", e.target.value)} />
            <div className="small muted" style={{ marginTop: 4 }}>
              {t("admin_shop_max_items_hint")}
            </div>
          </div>
          <div className="field">
            <label>{t("admin_shop_mode")}</label>
            <select className="input" value={form.shopping_default_mode || "hotspots"} onChange={(e) => set("shopping_default_mode", e.target.value)}>
              <option value="hotspots">{t("shop_mode_hotspots")}</option>
              <option value="list">{t("shop_mode_list")}</option>
            </select>
            <div className="small muted" style={{ marginTop: 4 }}>
              {t("admin_shop_mode_hint")}
            </div>
          </div>
          <div className="field">
            <label>{t("admin_shop_params")}</label>
            <input className="input" placeholder="utm_source=interier&partner_id=123" value={form.shopping_extra_params || ""} onChange={(e) => set("shopping_extra_params", e.target.value)} />
            <div className="small muted" style={{ marginTop: 4 }}>
              {t("admin_shop_params_hint")}
            </div>
          </div>
        </div>
      </div>

      {/* marketplaces */}
      <div className="panel mt">
        <h2 style={{ fontSize: 17 }}>🏬 {t("admin_shop_markets")}</h2>
        <p className="muted small" style={{ marginTop: 6 }}>
          {t("admin_shop_markets_hint")}
        </p>
        <div className="row mt" style={{ flexWrap: "wrap", gap: 8 }}>
          {markets.map((m) => {
            const on = enabledMarkets.includes(m.id);
            return (
              <button
                key={m.id}
                className={"btn btn-sm" + (on ? "" : " btn-ghost")}
                style={on ? { borderColor: "var(--accent)", background: "rgba(124,92,255,.14)" } : undefined}
                onClick={() => toggleMarket(m.id)}
                title={(m.strengths || []).join(", ")}
              >
                {m.emoji} {m.label}
              </button>
            );
          })}
        </div>
        <div className="small muted" style={{ marginTop: 10 }}>
          {t("admin_shop_markets_selected", { n: enabledMarkets.length })} · {enabledMarkets.join(" → ") || "—"}
        </div>
      </div>

      {/* categories */}
      <div className="panel mt">
        <h2 style={{ fontSize: 17 }}>🧩 {t("admin_shop_categories")}</h2>
        <p className="muted small" style={{ marginTop: 6 }}>
          {t("admin_shop_categories_hint")}
        </p>
        <div className="row mt" style={{ flexWrap: "wrap", gap: 8 }}>
          {categories.map((c) => (
            <span className="chip" key={c.id}>
              {c.emoji} {locale === "ru" ? c.ru : c.en}
            </span>
          ))}
        </div>
      </div>

      {/* AI tagger */}
      <div className="panel mt">
        <h2 style={{ fontSize: 17 }}>👁 {t("admin_shop_vision")}</h2>
        <label className="row mt" style={{ gap: 10, cursor: "pointer" }}>
          <input type="checkbox" style={{ width: 18, height: 18 }} checked={check("vision_enabled")} onChange={(e) => toggle("vision_enabled", e.target.checked)} />
          {t("admin_shop_vision_enabled")}
        </label>
        <div className="admin-grid mt">
          <div className="field">
            <label>{t("admin_shop_vision_provider")}</label>
            <select className="input" value={form.vision_provider || "inherit"} onChange={(e) => set("vision_provider", e.target.value)}>
              <option value="inherit">{t("admin_shop_vision_inherit")}</option>
              <option value="custom">custom</option>
            </select>
          </div>
          <div className="field">
            <label>{t("admin_shop_vision_base")}</label>
            <input className="input" value={form.vision_base_url || ""} onChange={(e) => set("vision_base_url", e.target.value)} placeholder="https://api.gen-api.ru" />
          </div>
          <div className="field">
            <label>{t("admin_shop_vision_key")}</label>
            <input className="input" type="password" autoComplete="off" value={form.vision_api_key || ""} onChange={(e) => set("vision_api_key", e.target.value)} />
          </div>
          <div className="field">
            <label>{t("admin_shop_vision_model")}</label>
            <input className="input" value={form.vision_model || ""} onChange={(e) => set("vision_model", e.target.value)} placeholder="gpt-4o-mini" />
            <div className="small muted" style={{ marginTop: 4 }}>
              {t("admin_shop_vision_model_hint")}
            </div>
          </div>
        </div>
        <div className="row" style={{ marginTop: 14 }}>
          <button className="btn btn-primary btn-sm" onClick={save} disabled={busy}>
            {t("admin_save")}
          </button>
          <span className="small muted">{t("admin_shop_vision_hint")}</span>
        </div>
      </div>
    </div>
  );
}
