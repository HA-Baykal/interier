"use client";

/**
 * Interior details of a design: hover the markers on the photo to see where to
 * buy each one, or switch to the list (better for a crowded render, for long
 * lists and for phones). Both views come from the same `DesignItem[]`, which is
 * also what the messenger bots render as text + link buttons.
 */

import { useState } from "react";
import { useLocale } from "./locale-context";

export type ItemsMode = "hotspots" | "list";

/**
 * Structural shape of one detail.
 *
 * The studio works with full `DesignItem[]` (ids, provenance, confidence), the
 * public gallery with a reduced `PublicShoppingItem[]`. Both satisfy this shape,
 * so a single component serves both — read-only there, editable here.
 */
export type ShopLink = { marketplace?: string; label?: string; url: string };
export type ShopItem = {
  id?: string;
  name: string;
  nameEn?: string;
  query?: string;
  bbox?: [number, number, number, number] | null;
  changed?: boolean;
  links: ShopLink[];
};

type Props<T extends ShopItem = ShopItem> = {
  items: T[];
  imageUrl: string;
  mode?: ItemsMode;
  detector?: "ai" | "heuristic" | "off";
  note?: string | null;
  onRefresh?: () => void;
  onManualAdd?: (label: string, x: number, y: number) => Promise<void> | void;
  onEditItem?: (item: T) => void;
  onRemoveItem?: (item: T) => void;
  busy?: boolean;
  /** Hides the mode switch (used in narrow cards). */
  hideToggle?: boolean;
  /** Hides the "how was this detected" caption (public pages). */
  hideMeta?: boolean;
};

export function marketplaceLabel(id: string): string {
  return (
    {
      ozon: "Ozon",
      yandex_market: "Яндекс Маркет",
      leroy_merlin: "Лемана ПРО",
      wildberries: "Wildberries",
      hoff: "Hoff",
      petrovich: "Петрович",
    }[id] || id
  );
}

export default function DesignItems<T extends ShopItem = ShopItem>({
  items,
  imageUrl,
  mode = "list",
  detector = "heuristic",
  note,
  onRefresh,
  onManualAdd,
  onEditItem,
  onRemoveItem,
  busy,
  hideToggle,
  hideMeta,
}: Props<T>) {
  const { t, locale } = useLocale();
  const [view, setView] = useState<ItemsMode>(mode);
  const [active, setActive] = useState<string | null>(null);
  const [pinning, setPinning] = useState(false);

  const hasBoxes = items.length > 0 && items.every((i) => !!i.bbox);
  const canHover = hasBoxes && view === "hotspots";
  const nameOf = (i: ShopItem) => (locale === "ru" ? i.name : i.nameEn || i.name);
  const keyOf = (i: ShopItem, index: number) => i.id || `${i.name}-${index}`;
  const linkLabel = (l: ShopLink) => l.label || marketplaceLabel(l.marketplace || "");

  async function handleImageClick(e: React.MouseEvent<HTMLDivElement>) {
    if (!pinning || !onManualAdd) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;
    const label = window.prompt(t("shop_manual_prompt") || "", "");
    if (!label) {
      setPinning(false);
      return;
    }
    await onManualAdd(label.trim(), Math.max(0, Math.min(1, x)), Math.max(0, Math.min(1, y)));
    setPinning(false);
  }

  return (
    <div className="shop-block">
      <div className="shop-head">
        <div>
          <div className="shop-title">🛒 {t("shop_title")}</div>
          {!hideMeta && (
            <div className="small muted">
              {t("shop_count", { n: items.length })} ·{" "}
              {detector === "ai" ? t("shop_detector_ai") : detector === "off" ? t("shop_detector_off") : t("shop_detector_heuristic")}
            </div>
          )}
        </div>
        <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
          {!hideToggle && hasBoxes && (
            <div className="lang-switch">
              <button className={view === "hotspots" ? "on" : ""} onClick={() => setView("hotspots")}>
                {t("shop_mode_hotspots")}
              </button>
              <button className={view === "list" ? "on" : ""} onClick={() => setView("list")}>
                {t("shop_mode_list")}
              </button>
            </div>
          )}
          {onRefresh && (
            <button className="btn btn-ghost btn-sm" onClick={onRefresh} disabled={busy}>
              🔄 {t("shop_refresh")}
            </button>
          )}
          {onManualAdd && (
            <button
              className={"btn btn-sm " + (pinning ? "btn-primary" : "btn-ghost")}
              onClick={() => setPinning((p) => !p)}
              disabled={busy}
              title={t("shop_add_manual_hint")}
            >
              📍 {t("shop_add_manual")}
            </button>
          )}
        </div>
      </div>

      {note && <div className="small muted" style={{ marginTop: 6 }}>ℹ️ {note}</div>}

      {canHover ? (
        <div className={"shop-image" + (pinning ? " pinning" : "")} onClick={handleImageClick}>
          <img src={imageUrl} alt="design" />
          {items.map((it, index) => {
            const [x, y, w, h] = it.bbox || [0.5, 0.5, 0.2, 0.2];
            const key = keyOf(it, index);
            const open = active === key;
            return (
              <div
                key={key}
                className={"shop-marker" + (it.changed ? " changed" : "") + (open ? " open" : "")}
                style={{
                  left: `${Math.min(96, Math.max(1, (x + w / 2) * 100))}%`,
                  top: `${Math.min(96, Math.max(1, (y + h / 2) * 100))}%`,
                }}
                onMouseEnter={() => setActive(key)}
                onMouseLeave={() => setActive((a) => (a === key ? null : a))}
              >
                <button
                  className="shop-dot"
                  aria-label={nameOf(it)}
                  onClick={(e) => {
                    e.stopPropagation();
                    setActive(open ? null : key);
                  }}
                >
                  {it.changed ? "✏️" : "＋"}
                </button>
                <div className="shop-tip" onClick={(e) => e.stopPropagation()}>
                  <div className="shop-tip-name">{nameOf(it)}</div>
                  {it.query && <div className="small muted">{t("shop_query_label")}: {it.query}</div>}
                  <div className="shop-tip-links">
                    {it.links.map((l, i) => (
                      <a key={i} href={l.url} target="_blank" rel="noopener noreferrer nofollow" className="chip shop-link">
                        {linkLabel(l)} →
                      </a>
                    ))}
                  </div>
                  {onEditItem && (
                    <button className="btn btn-ghost btn-sm" style={{ marginTop: 8 }} onClick={() => onEditItem(it)}>
                      ✏️ {t("edit_title")}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
          {pinning && <div className="shop-pin-hint">{t("shop_add_manual_hint")}</div>}
        </div>
      ) : (
        imageUrl && (
          <div className={"shop-image" + (pinning ? " pinning" : "")} onClick={handleImageClick}>
            <img src={imageUrl} alt="design" />
            {pinning && <div className="shop-pin-hint">{t("shop_add_manual_hint")}</div>}
          </div>
        )
      )}

      {items.length === 0 ? (
        <div className="small muted" style={{ marginTop: 10 }}>{t("shop_empty")}</div>
      ) : (
        <ul className="shop-list">
          {items.map((it, index) => (
            <li key={keyOf(it, index)} className={"shop-item" + (it.changed ? " changed" : "")}>
              <div className="shop-item-main">
                <span className="shop-item-name">
                  {it.changed && <span className="shop-badge">{t("shop_changed_badge")}</span>}
                  {nameOf(it)}
                </span>
                {it.query && <span className="small muted shop-item-query">{it.query}</span>}
              </div>
              <div className="shop-item-links">
                {it.links.map((l, i) => (
                  <a key={i} href={l.url} target="_blank" rel="noopener noreferrer nofollow" className="btn btn-ghost btn-sm">
                    {linkLabel(l)}
                  </a>
                ))}
                {onEditItem && (
                  <button className="btn btn-ghost btn-sm" onClick={() => onEditItem(it)} title={t("edit_title")}>
                    ✏️
                  </button>
                )}
                {onRemoveItem && (
                  <button className="btn btn-ghost btn-sm" onClick={() => onRemoveItem(it)} title={t("shop_remove")}>
                    🗑
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
