"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useLocale } from "@/components/locale-context";
import { t } from "@/lib/i18n";
import { ImageLightbox } from "@/components/ImageComparison";

type Item = {
  id: string;
  styleSlug: string;
  styleName: { ru: string; en: string };
  originalUrl: string;
  resultUrl: string;
  provider: string;
  createdAt: number;
};

export default function GalleryPage() {
  const { locale } = useLocale();
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [active, setActive] = useState<Item | null>(null);

  useEffect(() => {
    fetch("/api/gallery")
      .then((r) => r.json())
      .then((d) => setItems(d.items || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const nameOf = (it: Item) => (locale === "ru" ? it.styleName.ru : it.styleName.en);

  return (
    <div className="container" style={{ paddingTop: 44, paddingBottom: 70 }}>
      <div style={{ textAlign: "center", marginBottom: 30 }}>
        <h1 style={{ fontSize: 30, fontWeight: 800 }}>{t(locale, "gallery_title")}</h1>
        <p className="muted" style={{ marginTop: 8 }}>
          {t(locale, "gallery_subtitle")}
        </p>
      </div>

      {loading ? (
        <div className="panel center" style={{ padding: 60 }}>
          <div className="spinner" style={{ margin: "0 auto 16px" }} />
          <div className="muted">{t(locale, "common_loading")}</div>
        </div>
      ) : items.length === 0 ? (
        <div className="panel center" style={{ padding: 60, borderStyle: "dashed" }}>
          <div style={{ fontSize: 40, marginBottom: 10 }}>🖼️</div>
          <div className="muted">{t(locale, "gallery_empty")}</div>
        </div>
      ) : (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(250px, 1fr))",
            gap: 18,
          }}
        >
          {items.map((it) => (
            <button
              key={it.id}
              onClick={() => setActive(it)}
              className="gen-result"
              style={{ cursor: "zoom-in", textAlign: "left", padding: 0, border: "none", background: "transparent" }}
            >
              <div className="gallery-card">
                <img src={it.resultUrl} alt={nameOf(it)} loading="lazy" />
                <div className="gallery-overlay">
                  <span className="chip">{nameOf(it)}</span>
                </div>
              </div>
            </button>
          ))}
        </div>
      )}

      {active && <ImageLightbox before={active.originalUrl} after={active.resultUrl} title={`${nameOf(active)} · ${active.provider}`} onClose={() => setActive(null)} />}

      <div style={{ textAlign: "center", marginTop: 30 }}>
        <Link href="/studio" className="btn btn-primary">
          {t(locale, "cta_start")} →
        </Link>
      </div>
    </div>
  );
}
