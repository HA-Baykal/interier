"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useLocale } from "./locale-context";
import { authHeaders } from "@/lib/client-auth";
import { ClientStyle, ClientUser } from "./types";

type GenResult = {
  id: string;
  styleId: string;
  styleSlug: string;
  originalUrl: string;
  resultUrl: string | null;
  status: "processing" | "done" | "failed";
  provider: string;
  mode: "trial" | "credit" | "unlimited";
  demoConfig: { filter: string; tint: string; vignette: number; accent: string } | null;
  note: string | null;
  published?: boolean;
};

// Render an image with the style's color-grade applied (demo mode).
function StyledImage({
  url,
  cfg,
  alt,
}: {
  url: string;
  cfg: { filter: string; tint: string; vignette: number };
  alt: string;
}) {
  return (
    <div style={{ position: "relative", width: "100%", background: "#000" }}>
      <img
        src={url}
        alt={alt}
        style={{ width: "100%", display: "block", filter: cfg.filter }}
      />
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: cfg.tint,
          mixBlendMode: "soft-light",
          pointerEvents: "none",
        }}
      />
      <div
        style={{
          position: "absolute",
          inset: 0,
          pointerEvents: "none",
          boxShadow: `inset 0 0 ${Math.round(cfg.vignette * 220)}px rgba(0,0,0,${cfg.vignette})`,
        }}
      />
    </div>
  );
}

// Downscale/compress an uploaded photo on the client so it fits within
// serverless request-body limits (Vercel ~4.5MB) and reaches the API reliably.
const MAX_DIM = 2048;
const TARGET_BYTES = 2.8 * 1024 * 1024;

function fileToImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = (e) => { URL.revokeObjectURL(url); reject(e); };
    img.src = url;
  });
}

function canvasToBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
}

async function downscaleImage(file: File): Promise<File | null> {
  try {
    const img = await fileToImage(file);
    const scale = Math.min(1, MAX_DIM / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.max(1, Math.round(img.naturalWidth * scale));
    const h = Math.max(1, Math.round(img.naturalHeight * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) { URL.revokeObjectURL(img.src); return null; }
    ctx.drawImage(img, 0, 0, w, h);
    URL.revokeObjectURL(img.src);
    const baseName = (file.name.replace(/\.[^.]+$/, "") || "room") + ".jpg";
    for (const q of [0.9, 0.8, 0.7, 0.6]) {
      const blob = await canvasToBlob(canvas, q);
      if (blob && blob.size <= TARGET_BYTES) {
        return new File([blob], baseName, { type: "image/jpeg" });
      }
    }
    const blob = await canvasToBlob(canvas, 0.5);
    if (blob && blob.size <= TARGET_BYTES) return new File([blob], baseName, { type: "image/jpeg" });
    return null;
  } catch {
    return null;
  }
}

export default function Studio({ user, styles, aiConfigured, isDemo, initialUnlimited }: {
  user: ClientUser; styles: ClientStyle[]; aiConfigured: boolean; isDemo: boolean; initialUnlimited: boolean;
}) {
  const { t, locale } = useLocale();
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const camRef = useRef<HTMLInputElement>(null);

  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [styleId, setStyleId] = useState(styles[0]?.id ?? "");
  const [dragOver, setDragOver] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [results, setResults] = useState<GenResult[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<any[]>([]);
  const [unlimited, setUnlimited] = useState(initialUnlimited);
  const [compare, setCompare] = useState(true);
  const [pubIds, setPubIds] = useState<Record<string, boolean>>({});

  useEffect(() => {
    fetch("/api/generations", { headers: authHeaders() })
      .then((r) => r.json())
      .then((d) => setHistory(d.generations || []))
      .catch(() => {});
  }, []);

  useEffect(() => () => { if (previewUrl) URL.revokeObjectURL(previewUrl); }, [previewUrl]);

  async function acceptFile(f: File | null) {
    if (!f) return;
    if (!f.type.startsWith("image/")) {
      setError(t("studio_upload_hint"));
      return;
    }
    if (f.size > 20 * 1024 * 1024) {
      setError(t("studio_upload_hint"));
      return;
    }
    setError(null);
    try {
      // Downscale/compress so uploads fit within serverless body limits (Vercel
      // ~4.5MB) and reach the API reliably. Interior photos don't need PNG or
      // full resolution: a ~2048px JPEG at good quality is more than enough.
      const processed = await downscaleImage(f);
      if (!processed) {
        setError(t("studio_upload_hint"));
        return;
      }
      setFile(processed);
      setPreviewUrl(URL.createObjectURL(processed));
      setResults([]);
    } catch {
      setError(t("studio_upload_hint"));
    }
  }

  async function generate(scope: "single" | "all") {
    if (!file) {
      setError(t("studio_upload"));
      return;
    }
    if (scope === "single" && !styleId) {
      setError(t("studio_choose_style"));
      return;
    }
    setError(null);
    setGenerating(true);
    setResults([]);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("scope", scope);
      if (scope === "single") fd.append("styleId", styleId);
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: authHeaders(),
        body: fd,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (res.status === 401) {
          router.push("/login");
          return;
        }
        setError(
          data.error === "no_credits"
            ? t("studio_no_credits")
            : data.error === "no_trial"
            ? t("studio_no_credits")
            : data.message || data.error || (res.status === 413
              ? (locale === "ru" ? "Фото слишком большое для сервера. Выберите файл поменьше." : "Photo is too large for the server.")
              : `HTTP ${res.status}: ${t("common_error")}`)
        );
        return;
      }
      setResults(data.generations || []);
      if (typeof data.unlimited === "boolean") setUnlimited(data.unlimited);
      fetch("/api/generations", { headers: authHeaders(), cache: "no-store" })
        .then((r) => r.json()).then((d) => setHistory(d.generations || [])).catch(() => {});
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("common_error"));
    } finally {
      setGenerating(false);
    }
  }

  const creditsLabel = t("studio_credits", { n: user.credits });
  const trialAvailable = !user.trialUsed;

  // Resolve a style's demo color-grade config for the case where the backend
  // fell back to a demo preview (real provider selected, but no API key).
  function styleCfg(styleId: string) {
    const s = styles.find((x) => x.id === styleId);
    return s
      ? { filter: s.filter, tint: s.tint, vignette: s.vignette }
      : { filter: "none", tint: "transparent", vignette: 0 };
  }

  // True when the returned image is a genuinely generated one (not the upload,
  // not a demo preview).
  function isReal(r: GenResult) {
    return !!r.resultUrl && r.resultUrl !== r.originalUrl;
  }

  // Opt-in publish to the public gallery (owners choose; stays private otherwise).
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
      /* ignore network errors */
    }
  }

  return (
    <div className="container" style={{ paddingTop: 40, paddingBottom: 70 }}>
      <h1 style={{ fontSize: 30, fontWeight: 800 }}>{t("studio_title")}</h1>
      <p className="muted" style={{ marginTop: 6 }}>
        {isDemo ? t("studio_demo_note") : aiConfigured ? t("studio_ai_note") : t("studio_ai_missing")}
      </p>

      <div className="studio-layout mt">
        {/* Left: upload + controls */}
        <div>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            hidden
            onChange={(e) => acceptFile(e.target.files?.[0] ?? null)}
          />
          <input
            ref={camRef}
            type="file"
            accept="image/*"
            capture="environment"
            hidden
            onChange={(e) => acceptFile(e.target.files?.[0] ?? null)}
          />

          {!previewUrl ? (
            <div
              className={"upload-zone" + (dragOver ? " drag" : "")}
              onClick={() => fileRef.current?.click()}
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragOver(false);
                acceptFile(e.dataTransfer.files?.[0] ?? null);
              }}
            >
              <div className="icon">🏠</div>
              <div style={{ fontWeight: 600, fontSize: 16, marginBottom: 6 }}>{t("studio_upload")}</div>
              <div className="small">{t("studio_upload_hint")}</div>
              <div className="row" style={{ justifyContent: "center", marginTop: 16, gap: 8 }}>
                <button type="button" className="btn btn-primary btn-sm" onClick={(e) => { e.stopPropagation(); fileRef.current?.click(); }}>
                  {t("studio_upload")}
                </button>
                <button type="button" className="btn btn-ghost btn-sm" onClick={(e) => { e.stopPropagation(); camRef.current?.click(); }}>
                  📷 {t("studio_take_photo")}
                </button>
              </div>
            </div>
          ) : (
            <div>
              <div className="img-preview">
                <img src={previewUrl!} alt="preview" />
              </div>
              <div className="gen-meta">
                <button className="btn btn-ghost btn-sm" onClick={() => { setFile(null); setPreviewUrl(null); setResults([]); }}>
                  {t("studio_reupload")}
                </button>
              </div>
            </div>
          )}

          <div className="panel mt">
            <h2 style={{ fontSize: 18 }}>{t("studio_choose_style")}</h2>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 14 }}>
              {styles.map((s) => (
                <button
                  key={s.id}
                  onClick={() => setStyleId(s.id)}
                  className="btn btn-sm"
                  style={
                    styleId === s.id
                      ? { borderColor: s.accent, color: "#fff", background: s.accent + "22" }
                      : {}
                  }
                >
                  {locale === "ru" ? s.nameRu : s.nameEn}
                </button>
              ))}
            </div>
          </div>

          <div className="panel mt">
            <div className="row" style={{ flexWrap: "wrap", gap: 10 }}>
              <span className="chip">{creditsLabel}</span>
              {unlimited && <span className="chip" style={{ color: "var(--success)" }}>♾️ {t("studio_test_unlimited")}</span>}
              {trialAvailable && !unlimited && <span className="chip" style={{ color: "var(--success)" }}>🎁 {t("studio_free_left")}</span>}
            </div>

            {user.isAdmin && !isDemo && aiConfigured && (
              <p className="small muted mt">{t("studio_provider_billing_note")}</p>
            )}
            <div className="mt">
              <button
                className="btn btn-primary"
                style={{ width: "100%" }}
                disabled={generating || !file}
                onClick={() => generate("single")}
              >
                {generating ? t("studio_processing") : t("studio_gen_single")}
              </button>
            </div>
            {(trialAvailable || unlimited) && (
              <div className="mt">
                <button
                  className="btn btn-ghost"
                  style={{ width: "100%" }}
                  disabled={generating || !file}
                  onClick={() => generate("all")}
                >
                  {generating ? t("studio_processing") : t(user.isAdmin && !isDemo ? "studio_gen_all_paid" : "studio_gen_all")}
                </button>
              </div>
            )}
          </div>

          {error && <div className="err" role="alert" style={{ marginTop: 14 }}>{error}</div>}
        </div>

        {/* Right: results */}
        <div>
          {generating && (
            <div className="panel center" style={{ padding: 60 }}>
              <div className="spinner" style={{ margin: "0 auto 16px" }} />
              <div className="muted">{t("studio_processing")}</div>
            </div>
          )}

          {!generating && results.length === 0 && (
            <div className="panel center" style={{ padding: 60, borderStyle: "dashed" }}>
              <div style={{ fontSize: 40, marginBottom: 10 }}>🎨</div>
              <div className="muted">{t("studio_result")}</div>
            </div>
          )}

          {results.length === 1 ? (
            <div>
              <div className="row" style={{ justifyContent: "space-between", marginBottom: 12 }}>
                <h2 style={{ fontSize: 18 }}>{t("studio_result")}</h2>
                <span className="chip">{results[0].provider}</span>
              </div>

              {results[0].status === "done" && !isReal(results[0]) && (
                <div className="row" style={{ gap: 8, marginBottom: 10 }}>
                  <button className="btn btn-ghost btn-sm" onClick={() => setCompare((c) => !c)}>
                    {compare ? t("studio_hide_compare") : t("studio_show_compare")}
                  </button>
                  <span className="small muted">{t("studio_demo_badge")}</span>
                </div>
              )}

              {results[0].status === "failed" ? (
                <div className="panel err" role="alert">{results[0].note || t("common_error")}</div>
              ) : isReal(results[0]) ? (
                <div className="gen-result">
                  <img src={results[0].resultUrl!} alt="design" style={{ width: "100%", display: "block" }} />
                </div>
              ) : compare ? (
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                  <div>
                    <div className="small muted" style={{ marginBottom: 6 }}>{t("studio_original_label")}</div>
                    <div className="gen-result">
                      <img src={results[0].originalUrl} alt="original" style={{ width: "100%", display: "block" }} />
                    </div>
                  </div>
                  <div>
                    <div className="small muted" style={{ marginBottom: 6 }}>{t("studio_design_label")}</div>
                    <div className="gen-result">
                      <span className="demo-badge">{t("studio_demo_badge")}</span>
                      <StyledImage
                        url={results[0].originalUrl}
                        cfg={results[0].demoConfig ?? styleCfg(results[0].styleId)}
                        alt="design"
                      />
                    </div>
                  </div>
                </div>
              ) : (
                <div className="gen-result">
                  <span className="demo-badge">{t("studio_demo_badge")}</span>
                  <StyledImage
                    url={results[0].originalUrl}
                    cfg={results[0].demoConfig ?? styleCfg(results[0].styleId)}
                    alt="design"
                  />
                </div>
              )}
              {results[0].status !== "failed" && results[0].note && <div className="small muted" style={{ marginTop: 8 }}>{results[0].note}</div>}
              <div className="gen-meta">
                {isReal(results[0]) && (
                  <button
                    className={"btn btn-sm " + (pubIds[results[0].id] ? "btn-ghost" : "")}
                    onClick={() => togglePublish(results[0].id)}
                    disabled={generating}
                  >
                    {pubIds[results[0].id] ? t("gallery_unpublish") : t("gallery_publish")}
                  </button>
                )}
                {results[0].status === "done" && <a
                  className="btn btn-ghost btn-sm"
                  href={isReal(results[0]) ? results[0].resultUrl! : results[0].originalUrl}
                  download
                >
                  ⬇ {t("studio_download")}
                </a>}
                <button className="btn btn-primary btn-sm" onClick={() => generate("single")} disabled={generating}>
                  {t("studio_regenerate")}
                </button>
              </div>
            </div>
          ) : results.length > 1 ? (
            <div>
              <div className="row" style={{ justifyContent: "space-between", marginBottom: 12 }}>
                <h2 style={{ fontSize: 18 }}>{t("studio_result")}</h2>
                <span className="chip">{t("free_gen")}</span>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
                {results.map((r) => {
                  const st = styles.find((s) => s.id === r.styleId);
                  return (
                    <div key={r.id}>
                      <div className="gen-result">
                        {r.status === "done" && !isReal(r) && <span className="demo-badge">{t("studio_demo_badge")}</span>}
                        {r.status === "failed" ? (
                          <div className="panel err" role="alert">{r.note || t("common_error")}</div>
                        ) : isReal(r) ? (
                          <img src={r.resultUrl!} alt="design" style={{ width: "100%", display: "block" }} />
                        ) : (
                          <StyledImage
                            url={r.originalUrl}
                            cfg={r.demoConfig ?? styleCfg(r.styleId)}
                            alt="design"
                          />
                        )}
                      </div>
                      <div className="gen-meta">
                        <span style={{ fontWeight: 700 }}>{locale === "ru" ? st?.nameRu : st?.nameEn}</span>
                        {isReal(r) && (
                          <button
                            className={"btn btn-sm " + (pubIds[r.id] ? "btn-ghost" : "")}
                            onClick={() => togglePublish(r.id)}
                            disabled={generating}
                          >
                            {pubIds[r.id] ? t("gallery_unpublish") : t("gallery_publish")}
                          </button>
                        )}
                        {r.status === "done" && <a
                          className="btn btn-ghost btn-sm"
                          href={isReal(r) ? r.resultUrl! : r.originalUrl}
                          download
                        >
                          ⬇
                        </a>}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : null}
        </div>
      </div>

      {/* History */}
      {history.length > 0 && (
        <div className="panel mt">
          <h2 style={{ fontSize: 19 }}>{t("studio_history")}</h2>
          <div className="hist-list mt">
            {history.slice(0, 12).map((h) => (
              <div className="hist-item" key={h.id}>
                <img src={h.originalUrl} alt="" />
                <div className="grow">
                  <div style={{ fontWeight: 600 }}>{locale === "ru" ? h.styleName?.ru : h.styleName?.en}</div>
                  <div className="small muted">{new Date(h.createdAt).toLocaleString(locale === "ru" ? "ru-RU" : "en-US")}</div>
                </div>
                <span className="chip">{h.mode === "trial" ? "🎁" : "✦"} {h.status}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
