"use client";

import { useEffect, useRef, useState } from "react";
import { useLocale } from "./locale-context";
import { authHeaders } from "@/lib/client-auth";
import { preparePhoto } from "@/lib/client-image";
import {
  DEFAULT_TEST_PROFILE, GENAPI_MODELS, GENAPI_MODEL_IDS, MODEL_TEST_PROFILES, MODEL_PRICES_CHECKED_AT,
  getTestProfile, testProfileName, type GenApiModelId,
} from "@/lib/generation/model-catalog";
import ImageComparison, { ImageLightbox } from "./ImageComparison";
import type { ClientStyle } from "./types";

type Result = {
  id: string; status: string; originalUrl: string; resultUrl: string | null; testProfile?: string;
  provider: string; estimatedCostRub?: number; durationMs?: number; note?: string; error?: string;
};

export default function ModelLab({ enabled, styles }: { enabled: boolean; styles: ClientStyle[] }) {
  const { t, locale } = useLocale();
  const [profileId, setProfileId] = useState(DEFAULT_TEST_PROFILE);
  const [styleId, setStyleId] = useState(styles[0]?.id || "");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [recent, setRecent] = useState<Result[]>([]);
  const [view, setView] = useState<Result | null>(null);
  const inFlight = useRef(false);
  const selection = useRef(0);
  const profile = getTestProfile(profileId)!;
  const model = GENAPI_MODELS[profile.model];
  const variants = MODEL_TEST_PROFILES.filter((item) => item.model === profile.model);
  const money = (value: number) => value.toLocaleString(locale === "ru" ? "ru-RU" : "en-US", { maximumFractionDigits: 2 });
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);
  useEffect(() => {
    let active = true;
    fetch("/api/generations", { headers: authHeaders(), cache: "no-store" }).then(r => r.json()).then(data => {
      if (active) {
        const loaded: Result[] = (data.generations || []).filter((item: Result) => item.testProfile);
        setRecent(current => [...current, ...loaded.filter(item => !current.some(existing => existing.id === item.id))].slice(0, 8));
      }
    }).catch(() => {});
    return () => { active = false; };
  }, []);
  async function chooseFile(picked?: File) {
    if (!picked || inFlight.current) return;
    const id = ++selection.current;
    setPreparing(true); setError(null); setFile(null);
    try {
      // All three supported models accept JPEG/PNG. WebP is converted locally for Nano.
      const prepared = await preparePhoto(picked, true);
      if (id !== selection.current) return;
      setFile(prepared); setPreview(URL.createObjectURL(prepared));
    } catch { if (id === selection.current) setError(t("studio_upload_hint")); }
    finally { if (id === selection.current) setPreparing(false); }
  }
  function chooseModel(id: GenApiModelId) {
    setProfileId(id === "gpt-image-2" ? DEFAULT_TEST_PROFILE : MODEL_TEST_PROFILES.find(item => item.model === id)!.id);
  }
  async function run() {
    if (inFlight.current || !file || !styleId || !enabled || preparing) return;
    inFlight.current = true; setRunning(true); setError(null); setResult(null);
    try {
      const body = new FormData();
      body.set("file", file); body.set("scope", "single"); body.set("styleId", styleId); body.set("testProfile", profileId);
      const response = await fetch("/api/generate", { method: "POST", headers: authHeaders(), body });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.message || data.error || `HTTP ${response.status}`);
      const generated: Result | undefined = data.generations?.[0];
      if (!generated || data.isDemo) throw new Error(t("lab_unexpected"));
      setResult(generated);
      setRecent(items => [generated, ...items.filter(item => item.id !== generated.id)].slice(0, 8));
    } catch (e) { setError(e instanceof Error ? e.message : t("common_error")); }
    finally { inFlight.current = false; setRunning(false); }
  }
  return <section className="panel mt model-lab" id="model-lab" aria-labelledby="model-lab-heading">
    <div className="model-lab-heading"><div><span className="model-lab-eyebrow">GENAPI · {t("lab_admin_only")}</span><h2 id="model-lab-heading">{t("lab_title")}</h2></div><span className="chip">{t("lab_one_request")}</span></div>
    <p className="small muted mt">{t("lab_intro")}</p>
    {!enabled && <p className="err" role="status">{t("lab_not_configured")}</p>}
    <div className="model-lab-grid mt">
      <form onSubmit={event => { event.preventDefault(); void run(); }}>
        <div className="field"><label htmlFor="lab-model">{t("lab_model")}</label>
          <select id="lab-model" className="input" value={profile.model} disabled={running} onChange={event => chooseModel(event.target.value as GenApiModelId)}>
            {GENAPI_MODEL_IDS.map(id => <option key={id} value={id}>{GENAPI_MODELS[id].name}</option>)}
          </select>
        </div>
        <div className="field mt"><label htmlFor="lab-variant">{t("lab_variant")}</label>
          <select id="lab-variant" className="input" value={profileId} disabled={running || variants.length === 1} onChange={event => setProfileId(event.target.value)}>
            {variants.map(item => <option key={item.id} value={item.id}>{item.variant} — ≈{money(item.estimatedRub)} ₽</option>)}
          </select>
        </div>
        <div className="field mt"><label htmlFor="lab-style">{t("studio_choose_style")}</label>
          <select id="lab-style" className="input" value={styleId} disabled={running} onChange={event => setStyleId(event.target.value)}>
            {styles.map(item => <option key={item.id} value={item.id}>{locale === "ru" ? item.nameRu : item.nameEn}</option>)}
          </select>
        </div>
        <div className="field mt"><label htmlFor="lab-photo">{t("studio_upload")}</label>
          <input id="lab-photo" className="input" type="file" accept="image/jpeg,image/png,image/webp" disabled={running || preparing} onChange={event => void chooseFile(event.target.files?.[0])} />
        </div>
        {preview && <img className="model-lab-source" src={preview} alt={t("viewer_before")} />}
        <div className="model-lab-price mt"><strong>≈{money(profile.estimatedRub)} ₽</strong><span>{t("lab_estimate")}</span></div>
        <p className="small muted">{t("lab_tariff_note", { date: MODEL_PRICES_CHECKED_AT })} <a href={model.source} target="_blank" rel="noopener noreferrer">{t("studio_quality_tariff")} ↗</a></p>
        <button className="btn btn-primary mt" style={{ width: "100%" }} disabled={running || preparing || !enabled || !file || !styleId} type="submit">
          {running ? t("studio_processing") : preparing ? t("lab_preparing") : t("lab_run")}
        </button>
        <p className="small muted mt">{t("lab_paid_warning")}</p>
      </form>
      <div className="model-lab-output">
        {running ? <div className="model-lab-placeholder" role="status"><div className="spinner" /><p>{t("studio_processing")}</p><p className="small muted">{t("lab_wait")}</p></div>
          : result ? <>
            <div className="model-lab-result-heading"><strong>{result.testProfile ? testProfileName(result.testProfile) : result.provider}</strong>
              {typeof result.durationMs === "number" && <span className="chip">{(result.durationMs / 1000).toFixed(1)} {t("lab_seconds")}</span>}</div>
            {result.status === "done" && result.resultUrl ? <ImageComparison before={result.originalUrl} after={result.resultUrl} title={result.testProfile ? testProfileName(result.testProfile) : result.provider} />
              : <p className="panel err" role="alert">{result.note || result.error || t("common_error")}</p>}
          </> : <div className="model-lab-placeholder"><div className="model-lab-placeholder-icon">↔</div><p>{t("lab_empty")}</p><p className="small muted">{t("lab_empty_hint")}</p></div>}
        {error && <p className="err mt" role="alert">{error}</p>}
      </div>
    </div>
    {recent.length > 0 && <div className="model-lab-recent mt"><h3>{t("lab_recent")}</h3>
      {recent.map(item => <div className="model-lab-recent-row" key={item.id}>
        <span>{item.testProfile ? testProfileName(item.testProfile) : item.provider}<small className="muted">{item.status}{typeof item.estimatedCostRub === "number" ? ` · ${t("lab_estimate_short")} ≈${money(item.estimatedCostRub)} ₽` : ""}</small></span>
        {item.status === "done" && item.resultUrl ? <button type="button" className="btn btn-sm btn-ghost" onClick={() => setView(item)}>{t("viewer_expand")}</button>
          : <span className="small err">{item.note || item.error}</span>}
      </div>)}
    </div>}
    {view?.resultUrl && <ImageLightbox before={view.originalUrl} after={view.resultUrl} title={view.testProfile ? testProfileName(view.testProfile) : view.provider} onClose={() => setView(null)} />}
  </section>;
}
