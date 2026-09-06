"use client";

/**
 * "Where to buy" + "change only that" for one finished design.
 *
 * The website and the messenger bots edit the same record through the same
 * endpoints, so a design can be started in the studio, refined in Telegram and
 * finished in the browser without any divergence in behaviour.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import DesignItems, { type ShopItem } from "./DesignItems";
import { useLocale } from "./locale-context";
import { t } from "@/lib/i18n";

export type ShoppingView = {
  items: ShopItem[];
  mode?: "hotspots" | "list";
  detector?: "ai" | "heuristic" | "off";
  note?: string | null;
};

/** What an edit endpoint returns; kept structural so both the studio and the app can use it. */
export type EditedGeneration = {
  id: string;
  styleId: string;
  originalUrl: string;
  resultUrl: string | null;
  status: "processing" | "done" | "failed";
  provider: string;
  note: string | null;
  mode: "trial" | "credit" | "unlimited";
  quality?: string | null;
  demoConfig?: Record<string, unknown> | null;
  shopping?: { items: unknown[] } | null;
};

type Props = {
  generationId: string;
  /** The design image the markers are drawn on (never the source photo). */
  imageUrl: string;
  /** Called with the new record when a targeted edit finished. */
  onEdited?: (generation: EditedGeneration) => void;
  /** Public gallery: read-only, no edit form. */
  readOnly?: boolean;
};

export default function DesignEditor({ generationId, imageUrl, onEdited, readOnly = false }: Props) {
  const { locale } = useLocale();
  const [shopping, setShopping] = useState<ShoppingView | null>(null);
  // Initial view only: hotspots need coordinates, so the list is the safe default.
  const [mode, setMode] = useState<"hotspots" | "list">("list");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [editing, setEditing] = useState(false);
  const abort = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/generations/${generationId}/items`, { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json();
      if (data?.shopping) {
        setShopping(data.shopping as ShoppingView);
        const allPinned = (data.shopping.items as ShopItem[]).length > 0 &&
          (data.shopping.items as ShopItem[]).every((item) => Array.isArray(item.bbox));
        setMode(data.mode === "hotspots" && allPinned ? "hotspots" : "list");
      }
    } catch {
      /* the panel simply stays empty */
    }
  }, [generationId]);

  useEffect(() => {
    setShopping(null);
    setError(null);
    void load();
    return () => abort.current?.abort();
  }, [load]);

  const refresh = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/generations/${generationId}/items`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "refresh" }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) setError(data?.message || t(locale, "common_error"));
      else if (data?.shopping) setShopping(data.shopping as ShoppingView);
    } catch {
      setError(t(locale, "common_error"));
    } finally {
      setBusy(false);
    }
  }, [generationId, locale]);

  const addManual = useCallback(
    async (label: string, x: number, y: number) => {
      const res = await fetch(`/api/generations/${generationId}/items`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "add", label, x, y }),
      });
      if (res.ok) await load();
      else throw new Error(t(locale, "common_error"));
    },
    [generationId, locale, load]
  );

  const removeItem = useCallback(
    async (item: ShopItem) => {
      if (!item.id) return;
      setBusy(true);
      try {
        await fetch(`/api/generations/${generationId}/items?item=${encodeURIComponent(item.id)}`, { method: "DELETE" });
        await load();
      } finally {
        setBusy(false);
      }
    },
    [generationId, load]
  );

  async function runEdit() {
    const instruction = text.trim();
    if (instruction.length < 2 || editing) return;
    setEditing(true);
    setError(null);
    const controller = new AbortController();
    abort.current = controller;
    try {
      const res = await fetch(`/api/generations/${generationId}/edit`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ instruction }),
        signal: controller.signal,
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError(
          data?.error === "nothing_detected"
            ? t(locale, "edit_none")
            : data?.error === "no_credits" || data?.error === "no_trial"
              ? t(locale, "studio_no_credits")
              : data?.message || t(locale, "common_error")
        );
      } else {
        setText("");
        const generation = data?.generation as EditedGeneration | undefined;
        if (generation?.shopping) setShopping(generation.shopping as unknown as ShoppingView);
        else void load();
        if (generation) onEdited?.(generation);
      }
    } catch (e) {
      if ((e as Error)?.name !== "AbortError") setError(t(locale, "common_error"));
    } finally {
      setEditing(false);
      abort.current = null;
    }
  }

  const items = shopping?.items ?? [];

  return (
    <div className="shop-block">
      {(items.length > 0 || (!readOnly && !!shopping)) && (
        <DesignItems
          items={items}
          imageUrl={imageUrl}
          mode={mode}
          detector={shopping?.detector}
          note={shopping?.note}
          busy={busy}
          onRefresh={readOnly ? undefined : refresh}
          onManualAdd={readOnly ? undefined : addManual}
          onRemoveItem={readOnly ? undefined : removeItem}
        />
      )}

      {!readOnly && (
        <div className="panel" style={{ marginTop: 12, padding: 14 }}>
          <div className="row" style={{ justifyContent: "space-between", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
            <strong style={{ fontSize: 15 }}>{t(locale, "edit_title")}</strong>
            <span className="small muted">{t(locale, "edit_hint")}</span>
          </div>
          <div className="row" style={{ gap: 8, marginTop: 10, alignItems: "flex-end" }}>
            <textarea
              className="input"
              rows={2}
              maxLength={600}
              placeholder={t(locale, "edit_placeholder")}
              value={text}
              disabled={editing}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void runEdit();
              }}
              style={{ flex: 1, resize: "vertical" }}
            />
            <button className="btn btn-primary" onClick={() => void runEdit()} disabled={editing || text.trim().length < 2}>
              {editing ? t(locale, "edit_running") : t(locale, "edit_run")}
            </button>
          </div>
          {error && (
            <div className="panel err" role="alert" style={{ marginTop: 10, padding: 10 }}>
              {error}
            </div>
          )}
        </div>
      )}

      {!error && shopping && items.length === 0 && (
        <div className="small muted" style={{ marginTop: 8 }}>
          {t(locale, "shop_empty")}
        </div>
      )}
    </div>
  );
}
