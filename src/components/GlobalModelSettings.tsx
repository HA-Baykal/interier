"use client";

import { useEffect, useState } from "react";
import { useLocale } from "./locale-context";
import { authHeaders } from "@/lib/client-auth";
import { GENAPI_MODEL_IDS, GENAPI_MODELS, MODEL_TEST_PROFILES, testProfileName } from "@/lib/generation/model-catalog";
import type { adminSettingsView } from "@/lib/admin-settings";

type Settings = ReturnType<typeof adminSettingsView>;

export default function GlobalModelSettings({ activeProfile, enabled, onApplied }: {
  activeProfile: string | null; enabled: boolean; onApplied: (settings: Settings) => void;
}) {
  const { t, locale } = useLocale();
  const [selected, setSelected] = useState(activeProfile || "gpt-image-2:low");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { setSelected(activeProfile || "gpt-image-2:low"); }, [activeProfile]);
  async function apply() {
    if (saving || !enabled) return;
    setSaving(true); setMessage(null); setError(null);
    try {
      const response = await fetch("/api/admin/generation-profile", {
        method: "PUT", headers: { ...authHeaders(), "Content-Type": "application/json" }, body: JSON.stringify({ profileId: selected }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.ok) throw new Error(data.message || `HTTP ${response.status}`);
      onApplied(data.settings); setMessage(t("global_model_applied"));
    } catch (e) { setError(e instanceof Error ? e.message : t("common_error")); }
    finally { setSaving(false); }
  }
  return <section className="panel mt" id="global-generation-profile" aria-labelledby="global-model-heading">
    <h2 id="global-model-heading" style={{ fontSize: 23 }}>{t("global_model_title")}</h2>
    <p className="small muted mt">{t("global_model_help")}</p>
    <p className="mt"><span className="chip">{t("global_model_current")}: {activeProfile ? testProfileName(activeProfile) : t("global_model_custom")}</span></p>
    <label htmlFor="global-model-choice" className="small muted">{t("lab_model")}</label>
    <div className="row mt" style={{ flexWrap: "wrap" }}>
      <select id="global-model-choice" className="input" style={{ flex: 1, minWidth: 200 }} value={selected} disabled={saving || !enabled} onChange={event => setSelected(event.target.value)}>
        {GENAPI_MODEL_IDS.map(model => <optgroup key={model} label={GENAPI_MODELS[model].name}>
          {MODEL_TEST_PROFILES.filter(profile => profile.model === model).map(profile => <option key={profile.id} value={profile.id}>{GENAPI_MODELS[model].name} · {profile.variant} — ≈{profile.estimatedRub.toLocaleString(locale === "ru" ? "ru-RU" : "en-US")} ₽</option>)}
        </optgroup>)}
      </select>
      <button type="button" className="btn btn-primary" onClick={apply} disabled={saving || !enabled}>{saving ? t("common_loading") : t("global_model_apply")}</button>
    </div>
    {!enabled && <p className="err mt">{t("lab_not_configured")}</p>}
    {message && <p className="ok mt" role="status">{message}</p>}
    {error && <p className="err mt" role="alert">{error}</p>}
  </section>;
}
