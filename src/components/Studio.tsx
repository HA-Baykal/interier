"use client";

/**
 * Design studio (the web front-end of the same pipeline the bots use):
 *   photo → style → design → interior details with marketplace links
 *                         ↘ free-text instruction: "замени только шторы" → targeted edit
 */

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useLocale } from "./locale-context";
import { authHeaders } from "@/lib/client-auth";
import { ClientStyle, ClientUser } from "./types";
import DesignItems from "./DesignItems";
import { downscaleImage } from "@/lib/client-image";
import type { DesignItem, ShoppingList } from "@/lib/types";

type DemoCfg = { filter: string; tint: string; vignette: number; accent?: string };

export type GenResult = {
  id: string;
  styleId: string;
  styleSlug: string;
  styleName?: { ru: string; en: string };
  originalUrl: string;
  resultUrl: string | null;
  status: "processing" | "done" | "failed";
  provider: string;
  mode: "trial" | "credit" | "unlimited";
  demoConfig: DemoCfg | null;
  note: string | null;
  error?: string | null;
  published?: boolean;
  kind?: "design" | "edit";
  createdAt?: number;
  instruction?: string | null;
  changedCategories?: string[];
  shopping?: ShoppingList | null;
};

const QUICK_EDITS = [
  { ru: "замени только шторы", en: "replace only the curtains" },
  { ru: "поменяй диван на серый", en: "swap the sofa for a grey one" },
  { ru: "добавь торшер у дивана", en: "add a floor lamp next to the sofa" },
  { ru: "перекрась стены в бежевый", en: "paint the walls beige" },
  { ru: "замени ковёр на джутовый", en: "replace the rug with a jute one" },
  { ru: "убери всё лишнее с полок", en: "remove everything extra from the shelves" },
];

// Render an image with the style's color-grade applied (demo mode).
function StyledImage({ url, cfg, alt }: { url: string; cfg: DemoCfg; alt: string }) {
  return (
    <div style={{ position: "relative", width: "100%", background: "#000" }}>
      <img src={url} alt={alt} style={{ width: "100%", display: "block", filter: cfg.filter }} />
      <div style={{ position: "absolute", inset: 0, background: cfg.tint, mixBlendMode: "soft-light", pointerEvents: "none" }} />
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

// Client-side downscale/compress shared with the mini app (see lib/client-image).
export default function Studio({ user, styles }: { user: ClientUser; styles: ClientStyle[] }) {
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
  const [history, setHistory] = useState<GenResult[]>([]);
  const [unlimited, setUnlimited] = useState(false);
  const [compare, setCompare] = useState(true);
  const [pubIds, setPubIds] = useState<Record<string, boolean>>({});

  // Free-text wish for the next render, and the source of targeted edits.
  const [instruction, setInstruction] = useState("");
  const [editBusy, setEditBusy] = useState(false);
  const [editNotice, setEditNotice] = useState<string | null>(null);
  const [detected, setDetected] = useState<string[] | null>(null);

  const quick = QUICK_EDITS.map((q) => (locale === "ru" ? q.ru : q.en));

  useEffect(() => {
    loadHistory();
  }, []);

  async function loadHistory() {
    try {
      const r = await fetch("/api/generations", { headers: authHeaders() });
      const d = await r.json();
      setHistory(d.generations || []);
    } catch {
      /* ignore */
    }
  }

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
    setEditNotice(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("scope", scope);
      if (scope === "single") fd.append("styleId", styleId);
      if (instruction.trim()) fd.append("instruction", instruction.trim());
      const res = await fetch("/api/generate", { method: "POST", headers: authHeaders(), body: fd });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (res.status === 401) {
          router.push("/login");
          return;
        }
        setError(data.error === "no_credits" || data.error === "no_trial" ? t("studio_no_credits") : t("common_error"));
        return;
      }
      setResults(data.generations || []);
      if (typeof data.unlimited === "boolean") setUnlimited(data.unlimited);
      loadHistory();
      router.refresh();
    } catch {
      setError(t("common_error"));
    } finally {
      setGenerating(false);
    }
  }

  /** Targeted edit: keep this design, change only what the words describe. */
  async function applyEdit(text: string, targetGenerationId?: string) {
    const genId = targetGenerationId || results.find((r) => r.status === "done")?.id || history[0]?.id;
    const body = (text || "").trim();
    if (!genId || body.length < 2) return;
    setEditBusy(true);
    setError(null);
    setEditNotice(null);
    try {
      const res = await fetch(`/api/generations/${genId}/edit`, {
        method: "POST",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ instruction: body, styleId: styleId || undefined }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (data.error === "nothing_detected") setError(t("edit_none"));
        else if (data.error === "no_credits" || data.error === "no_trial") setError(t("studio_no_credits"));
        else setError(t("common_error"));
        return;
      }
      setResults([data.generation]);
      setDetected((data.targets || []).map((x: { ru: string }) => x.ru));
      setEditNotice(t("edit_source", { when: new Date().toLocaleTimeString(locale === "ru" ? "ru-RU" : "en-US") }));
      setInstruction("");
      await loadHistory();
      router.refresh();
    } catch {
      setError(t("common_error"));
    } finally {
      setEditBusy(false);
    }
  }

  async function refreshItems(genId: string) {
    setEditBusy(true);
    try {
      const res = await fetch(`/api/generations/${genId}/items`, {
        method: "POST",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ action: "refresh" }),
      });
      const data = await res.json().catch(() => ({}));
      if (data.shopping) {
        setResults((rs) => rs.map((r) => (r.id === genId ? { ...r, shopping: data.shopping } : r)));
        setHistory((hs) => hs.map((h) => (h.id === genId ? { ...h, shopping: data.shopping } : h)));
        setEditNotice(t("shop_refreshed"));
      }
    } finally {
      setEditBusy(false);
    }
  }

  async function addItem(genId: string, label: string, x: number, y: number) {
    const res = await fetch(`/api/generations/${genId}/items`, {
      method: "POST",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ action: "add", label, x, y }),
    });
    const data = await res.json().catch(() => ({}));
    if (data.item) {
      setResults((rs) =>
        rs.map((r) =>
          r.id === genId
            ? {
                ...r,
                shopping: {
                  ...((r.shopping || { items: [], mode: "list", detector: "heuristic", updatedAt: Date.now() }) as ShoppingList),
                  items: [...(r.shopping?.items || []), data.item as DesignItem],
                } as ShoppingList,
              }
            : r
        )
      );
    }
  }

  async function removeItem(genId: string, item: DesignItem) {
    await fetch(`/api/generations/${genId}/items?item=${encodeURIComponent(item.id)}`, { method: "DELETE", headers: authHeaders() });
    setResults((rs) =>
      rs.map((r) =>
        r.id === genId && r.shopping ? { ...r, shopping: { ...r.shopping, items: r.shopping.items.filter((i) => i.id !== item.id) } } : r
      )
    );
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
      if (res.ok) {
        setPubIds((p) => ({ ...p, [id]: next }));
        setResults((rs) => rs.map((r) => (r.id === id ? { ...r, published: next } : r)));
      }
    } catch {
      /* ignore network errors */
    }
  }

  const creditsLabel = t("studio_credits", { n: user.credits });
  const trialAvailable = !user.trialUsed;

  // Resolve a style's demo color-grade config for the case where the backend
  // fell back to a demo preview (real provider selected, but no API key).
  function styleCfg(id: string): DemoCfg {
    const s = styles.find((x) => x.id === id);
    return s ? { filter: s.filter, tint: s.tint, vignette: s.vignette } : { filter: "none", tint: "transparent", vignette: 0 };
  }

  // True when the returned image is a genuinely generated one (not the upload,
  // not a demo preview).
  function isReal(r: GenResult) {
    return !!r.resultUrl && r.resultUrl !== r.originalUrl;
  }

  const mainResult = results[0] || null;
  const mainImage = mainResult ? mainResult.resultUrl || mainResult.originalUrl : null;

  return (
    <div className="container" style={{ paddingTop: 40, paddingBottom: 70 }}>
      <h1 style={{ fontSize: 30, fontWeight: 800 }}>{t("studio_title")}</h1>
      <p className="muted" style={{ marginTop: 6 }}>
        {t("studio_demo_note")}
      </p>

      <div className="studio-layout mt">
        {/* Left: upload + controls */}
        <div>
          <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => acceptFile(e.target.files?.[0] ?? null)} />
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
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  onClick={(e) => {
                    e.stopPropagation();
                    fileRef.current?.click();
                  }}
                >
                  {t("studio_upload")}
                </button>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={(e) => {
                    e.stopPropagation();
                    camRef.current?.click();
                  }}
                >
                  📷 {t("studio_take_photo")}
                </button>
              </div>
            </div>
          ) : (
            <div>
              <div className="img-preview">
                <img src={previewUrl} alt="preview" />
              </div>
              <div className="gen-meta">
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={() => {
                    setFile(null);
                    setPreviewUrl(null);
                    setResults([]);
                  }}
                >
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
                  style={styleId === s.id ? { borderColor: s.accent, color: "#fff", background: s.accent + "22" } : {}}
                >
                  {locale === "ru" ? s.nameRu : s.nameEn}
                </button>
              ))}
            </div>
          </div>

          {/* Free-text wish: used for this render and for later targeted edits */}
          <div className="panel mt">
            <h2 style={{ fontSize: 18 }}>✏️ {t("edit_title")}</h2>
            <p className="small muted" style={{ marginTop: 6 }}>
              {t("edit_hint")}
            </p>
            <textarea
              className="input"
              rows={3}
              style={{ width: "100%", marginTop: 10, resize: "vertical" }}
              placeholder={t("edit_placeholder")}
              value={instruction}
              onChange={(e) => setInstruction(e.target.value)}
            />
            <div className="row" style={{ flexWrap: "wrap", gap: 6, marginTop: 10 }}>
              {quick.map((q) => (
                <button key={q} className="btn btn-ghost btn-sm" onClick={() => setInstruction(q)} type="button">
                  {q}
                </button>
              ))}
            </div>
            {detected && detected.length > 0 && (
              <div className="small" style={{ marginTop: 10, color: "var(--success)" }}>
                {t("edit_targets", { list: detected.join(", ") })}
              </div>
            )}
            <div className="mt">
              <button
                className="btn btn-primary"
                style={{ width: "100%" }}
                disabled={editBusy || instruction.trim().length < 2 || !mainResult}
                onClick={() => applyEdit(instruction, mainResult?.id)}
              >
                {editBusy ? t("edit_running") : t("edit_run")}
              </button>
            </div>
            {editNotice && <div className="small muted" style={{ marginTop: 8 }}>{editNotice}</div>}
          </div>

          <div className="panel mt">
            <div className="row" style={{ flexWrap: "wrap", gap: 10 }}>
              <span className="chip">{creditsLabel}</span>
              {unlimited && (
                <span className="chip" style={{ color: "var(--success)" }}>
                  ♾️ {t("studio_test_unlimited")}
                </span>
              )}
              {trialAvailable && !unlimited && (
                <span className="chip" style={{ color: "var(--success)" }}>
                  🎁 {t("studio_free_left")}
                </span>
              )}
            </div>

            <div className="mt">
              <button className="btn btn-primary" style={{ width: "100%" }} disabled={generating || !file} onClick={() => generate("single")}>
                {generating ? t("studio_processing") : t("studio_gen_single")}
              </button>
            </div>
            {(trialAvailable || unlimited) && (
              <div className="mt">
                <button className="btn btn-ghost" style={{ width: "100%" }} disabled={generating || !file} onClick={() => generate("all")}>
                  {generating ? t("studio_processing") : t("studio_gen_all")}
                </button>
              </div>
            )}
          </div>

          {error && <div className="err" style={{ marginTop: 14 }}>{error}</div>}
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

          {!generating && results.length === 1 && mainResult && (
            <div>
              <div className="row" style={{ justifyContent: "space-between", marginBottom: 12 }}>
                <h2 style={{ fontSize: 18 }}>
                  {mainResult.kind === "edit" ? "✏️ " : ""}
                  {t("studio_result")}
                </h2>
                <span className="chip">{mainResult.provider}</span>
              </div>

              {!isReal(mainResult) && (
                <div className="row" style={{ gap: 8, marginBottom: 10 }}>
                  <button className="btn btn-ghost btn-sm" onClick={() => setCompare((c) => !c)}>
                    {compare ? t("studio_hide_compare") : t("studio_show_compare")}
                  </button>
                  <span className="small muted">{t("studio_demo_badge")}</span>
                </div>
              )}

              {!isReal(mainResult) && compare ? (
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                  <div>
                    <div className="small muted" style={{ marginBottom: 6 }}>
                      {t("studio_original_label")}
                    </div>
                    <div className="gen-result">
                      <img src={mainResult.originalUrl} alt="original" style={{ width: "100%", display: "block" }} />
                    </div>
                  </div>
                  <div>
                    <div className="small muted" style={{ marginBottom: 6 }}>
                      {t("studio_design_label")}
                    </div>
                    <div className="gen-result">
                      <span className="demo-badge">{t("studio_demo_badge")}</span>
                      <StyledImage url={mainResult.originalUrl} cfg={mainResult.demoConfig ?? styleCfg(mainResult.styleId)} alt="design" />
                    </div>
                  </div>
                </div>
              ) : !isReal(mainResult) ? (
                <div className="gen-result">
                  <span className="demo-badge">{t("studio_demo_badge")}</span>
                  <StyledImage url={mainResult.originalUrl} cfg={mainResult.demoConfig ?? styleCfg(mainResult.styleId)} alt="design" />
                </div>
              ) : mainResult.shopping?.items.length ? (
                <DesignItems
                  items={mainResult.shopping.items}
                  imageUrl={mainImage!}
                  mode={mainResult.shopping.mode}
                  detector={mainResult.shopping.detector}
                  note={mainResult.shopping.note}
                  busy={editBusy}
                  onRefresh={() => refreshItems(mainResult.id)}
                  onRemoveItem={(it) => removeItem(mainResult.id, it)}
                  onManualAdd={(label, x, y) => addItem(mainResult.id, label, x, y)}
                  onEditItem={(it) =>
                    setInstruction(
                      locale === "ru"
                        ? `замени только ${it.name.toLowerCase()} — ${it.query}; остальное не меняй`
                        : `replace only the ${it.nameEn || it.name} — ${it.queryEn || it.query}; keep everything else`
                    )
                  }
                />
              ) : (
                <div className="gen-result">
                  <img src={mainResult.resultUrl!} alt="design" style={{ width: "100%", display: "block" }} />
                </div>
              )}

              {mainResult.instruction && (
                <div className="small muted" style={{ marginTop: 8 }}>
                  ✏️ «{mainResult.instruction}»
                </div>
              )}
              {mainResult.note && <div className="small muted" style={{ marginTop: 8 }}>{mainResult.note}</div>}
              {mainResult.error && <div className="err" style={{ marginTop: 8 }}>{mainResult.error}</div>}

              <div className="gen-meta">
                {isReal(mainResult) && (
                  <button
                    className={"btn btn-sm " + (pubIds[mainResult.id] ? "btn-ghost" : "")}
                    onClick={() => togglePublish(mainResult.id)}
                    disabled={generating}
                  >
                    {pubIds[mainResult.id] ? t("gallery_unpublish") : t("gallery_publish")}
                  </button>
                )}
                <a className="btn btn-ghost btn-sm" href={isReal(mainResult) ? mainResult.resultUrl! : mainResult.originalUrl} download>
                  ⬇ {t("studio_download")}
                </a>
                <button className="btn btn-primary btn-sm" onClick={() => generate("single")} disabled={generating}>
                  {t("studio_regenerate")}
                </button>
              </div>
            </div>
          )}

          {!generating && results.length > 1 && (
            <div>
              <div className="row" style={{ justifyContent: "space-between", marginBottom: 12 }}>
                <h2 style={{ fontSize: 18 }}>{t("studio_result")}</h2>
                <span className="chip">{t("free_gen")}</span>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
                {results.map((r) => {
                  const st = styles.find((s) => s.id === r.styleId);
                  return (
                    <div key={r.id} style={{ marginBottom: 18 }}>
                      <div className="gen-result">
                        {!isReal(r) && <span className="demo-badge">{t("studio_demo_badge")}</span>}
                        {isReal(r) ? (
                          <img src={r.resultUrl!} alt="design" style={{ width: "100%", display: "block" }} />
                        ) : (
                          <StyledImage url={r.originalUrl} cfg={r.demoConfig ?? styleCfg(r.styleId)} alt="design" />
                        )}
                      </div>
                      {!!r.shopping?.items.length && (
                        <div className="small muted" style={{ marginTop: 8 }}>
                          🛒 {t("shop_count", { n: r.shopping.items.length })}{" "}
                          <button className="btn btn-ghost btn-sm" onClick={() => setResults([r])}>
                            {t("shop_title")}
                          </button>
                        </div>
                      )}
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
                        <a className="btn btn-ghost btn-sm" href={isReal(r) ? r.resultUrl! : r.originalUrl} download>
                          ⬇
                        </a>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
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
                  <div style={{ fontWeight: 600 }}>
                    {h.kind === "edit" ? "✏️ " : ""}
                    {locale === "ru" ? h.styleName?.ru : h.styleName?.en}
                  </div>
                  <div className="small muted">{new Date(h.createdAt || Date.now()).toLocaleString(locale === "ru" ? "ru-RU" : "en-US")}</div>
                  {h.instruction && <div className="small muted">«{h.instruction}»</div>}
                  {!!h.shopping?.items.length && <div className="small muted">🛒 {t("shop_count", { n: h.shopping.items.length })}</div>}
                </div>
                <div className="row" style={{ gap: 6 }}>
                  <span className="chip">
                    {h.mode === "trial" ? "🎁" : "✦"} {h.status}
                  </span>
                  <button
                    className="btn btn-ghost btn-sm"
                    onClick={() => {
                      setResults([h]);
                      window.scrollTo({ top: 0, behavior: "smooth" });
                    }}
                  >
                    👁
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
