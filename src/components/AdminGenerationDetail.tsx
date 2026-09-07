"use client";

/**
 * Generation details panel for the owner.
 *
 * Answers «почему у генерации нет списка деталей?» without reading code: for
 * every design it shows the detector, the mode (hotspots vs list), the item
 * count and — when the list is empty — a plain-language reason
 * (off / auto=0 / vision unavailable / old generation). Selecting a row opens
 * the full item list with hotspots and marketplace links.
 */

import { useCallback, useEffect, useState } from "react";
import { useLocale } from "./locale-context";
import { authHeaders } from "@/lib/client-auth";

type GenRow = {
  id: string;
  createdAt: number;
  styleId: string;
  kind: string;
  status: string;
  origin: string;
  owner: string;
  detector: "ai" | "heuristic" | "off" | null;
  mode: "hotspots" | "list" | null;
  items: number;
  hotspots: number;
  note: string | null;
  reason: "off" | "auto0" | "vision" | "old" | "empty" | null;
};

type Settings = {
  enabled: boolean;
  auto: boolean;
  defaultMode: string;
  marketplaces: string[];
};

type Item = {
  id: string;
  name: string;
  nameEn: string;
  category: string;
  source: string;
  bbox: [number, number, number, number] | null;
  links: { marketplace: string; label: string; url: string }[];
};

type Detail = {
  shopping: {
    items: Item[];
    mode: string;
    detector: string;
    note: string | null;
  } | null;
  mode: string;
};

export default function AdminGenerationDetail() {
  const { t, locale } = useLocale();
  const [rows, setRows] = useState<GenRow[]>([]);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch("/api/admin/generations", { headers: authHeaders(), cache: "no-store" });
    if (!res.ok) {
      setErr(t("common_error"));
      return;
    }
    const data = await res.json();
    setRows(data.generations || []);
    setSettings(data.settings || null);
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  const open = async (id: string) => {
    setSelected(id);
    setDetail(null);
    const res = await fetch(`/api/generations/${id}/items`, { headers: authHeaders(), cache: "no-store" });
    if (res.ok) setDetail(await res.json());
  };

  const refresh = async (id: string) => {
    setBusy(true);
    await fetch(`/api/generations/${id}/items`, {
      method: "POST",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ action: "refresh" }),
    });
    await open(id);
    await load();
    setBusy(false);
  };

  const reasonKey = (r: GenRow["reason"]) =>
    r === null ? "admin_gen_has" : (`admin_gen_reason_${r}` as const);

  const fmt = (ts: number) =>
    new Date(ts).toLocaleString(locale === "ru" ? "ru-RU" : "en-US", {
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });

  return (
    <div className="panel mt" id="admin-generations">
      <div className="row" style={{ justifyContent: "space-between", flexWrap: "wrap", gap: 10 }}>
        <div>
          <h2 style={{ fontSize: 19 }}>🔎 {t("admin_gen_title")}</h2>
          <p className="muted small" style={{ marginTop: 6 }}>{t("admin_gen_subtitle")}</p>
        </div>
        <button className="btn btn-sm btn-ghost" onClick={load} disabled={busy}>🔄 {t("admin_bots_reload")}</button>
      </div>

      {settings && (
        <p className="small muted mt">
          {t("admin_shop_enabled")}: {settings.enabled ? "on" : "off"} · auto: {settings.auto ? "on" : "off"} ·{" "}
          {t("admin_gen_mode")}: {settings.defaultMode}
        </p>
      )}

      {err && <div className="err mt">{err}</div>}

      {selected && detail && (
        <div className="panel mt">
          <div className="row" style={{ justifyContent: "space-between" }}>
            <b className="small">{selected.slice(0, 13)}…</b>
            <button className="btn btn-sm btn-ghost" onClick={() => setSelected(null)}>{t("admin_gen_back")}</button>
          </div>
          {detail.shopping ? (
            <>
              <p className="small muted mt">
                {t("admin_gen_detector")}: {detail.shopping.detector} · {t("admin_gen_mode")}: {detail.shopping.mode} ·{" "}
                {detail.shopping.items.length} {t("admin_gen_items")}
              </p>
              {detail.shopping.note && <p className="small muted">{t("admin_gen_note")}: {detail.shopping.note}</p>}
              <div className="mt">
                {detail.shopping.items.map((it) => (
                  <div key={it.id} className="hist-item">
                    <div className="grow">
                      <div style={{ fontWeight: 600 }}>
                        {locale === "ru" ? it.name : it.nameEn || it.name}{" "}
                        <span className="small muted">({it.category}, {it.source}{it.bbox ? ", hotspot" : ""})</span>
                      </div>
                      <div className="small muted">
                        {it.links.length} {t("admin_gen_links")}: {it.links.map((l) => l.marketplace).join(", ") || "—"}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <p className="small muted mt">{t("admin_gen_empty")}</p>
          )}
          <div className="row mt">
            <button className="btn btn-sm" onClick={() => refresh(selected)} disabled={busy}>
              {t("admin_gen_refresh")}
            </button>
          </div>
        </div>
      )}

      {!rows.length && !selected && <p className="muted small mt">{t("admin_gen_empty")}</p>}

      {!selected && (
        <div className="mt">
          {rows.map((r) => (
            <button
              key={r.id}
              className="hist-item"
              style={{ width: "100%", textAlign: "left", cursor: "pointer", background: "none", border: "none" }}
              onClick={() => open(r.id)}
            >
              <div className="grow">
                <div style={{ fontWeight: 600 }}>
                  {fmt(r.createdAt)} · {r.styleId} <span className="small muted">({r.owner}, {r.origin})</span>
                </div>
                <div className="small muted">
                  {r.items} {t("admin_gen_items")} · {r.hotspots} {t("admin_gen_hotspots")} · {t(reasonKey(r.reason))}
                </div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
