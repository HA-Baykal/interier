"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useLocale } from "./locale-context";
import { authHeaders } from "@/lib/client-auth";
import { ClientPackage, ClientStyle } from "./types";
import ModelLab from "./ModelLab";
import GlobalModelSettings from "./GlobalModelSettings";
import TelegramSetup from "./TelegramSetup";

type Settings = {
  generation_mode: string;
  free_credits: string;
  daily_free_image_limit: string;
  reward_telegram: string;
  reward_vk: string;
  reward_referral: string;
  test_unlimited: string;
  compatible_provider: string;
  compatible_base_url: string;
  compatible_api_key: string;
  compatible_model: string;
  compatible_quality?: string;
  compatible_resolution?: string;
  active_profile?: string | null;
  compatible_configured: boolean;
  compatible_key_source?: string;
};

type Env = { hasReplicate: boolean; hasOpenAI: boolean; hasTogether: boolean };

type Stats = { users: number; generations: number; credits: number; referrals: number };

export default function Admin({
  stats,
  settings,
  styles,
  packages,
  env,
}: {
  stats: Stats;
  settings: Settings;
  styles: ClientStyle[];
  packages: ClientPackage[];
  env: Env;
}) {
  const { t, locale } = useLocale();
  const router = useRouter();
  const [form, setForm] = useState(settings);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [probing, setProbing] = useState(false);
  const [diagnostics, setDiagnostics] = useState<string | null>(null);

  function field(key: keyof Settings) {
    return (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      setForm((f) => ({ ...f, [key]: e.target.value }));
  }

  async function saveSettings() {
    setSaving(true);
    setError(null);
    setMsg(null);
    try {
      const res = await fetch("/api/admin/settings", {
        method: "PUT",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) throw new Error(data.message || data.error || `HTTP ${res.status}`);
      setForm(data.settings);
      setMsg(t("admin_saved"));
      setDiagnostics(null);
      router.refresh();
    } catch (e) { setError(e instanceof Error ? e.message : t("common_error")); }
    finally { setSaving(false); }
  }

  async function checkGeneration() {
    setProbing(true);
    setError(null);
    setDiagnostics(null);
    try {
      const res = await fetch("/api/admin/genstatus?probe=1", { headers: authHeaders(), cache: "no-store" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message || data.error || `HTTP ${res.status}`);
      setDiagnostics(JSON.stringify(data, null, 2));
    } catch (e) { setError(e instanceof Error ? e.message : t("common_error")); }
    finally { setProbing(false); }
  }

  async function toggleStyle(id: string, active: boolean) {
    await fetch(`/api/admin/styles/${id}`, {
      method: "PATCH",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ active }),
    });
    router.refresh();
  }

  async function delStyle(id: string) {
    await fetch(`/api/admin/styles/${id}`, { method: "DELETE", headers: authHeaders() });
    router.refresh();
  }

  async function addStyle() {
    const slug = prompt("Slug (e.g. boho)");
    if (!slug) return;
    const nameRu = prompt("Название (RU)") || slug;
    const nameEn = prompt("Name (EN)") || slug;
    const descRu = prompt("Описание (RU)") || "";
    const descEn = prompt("Description (EN)") || "";
    const res = await fetch("/api/admin/styles", {
      method: "POST",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ slug, nameRu, nameEn, descRu, descEn }),
    });
    if (res.ok) router.refresh();
  }

  async function addPackage() {
    const slug = prompt("Slug (e.g. premium)") || "";
    if (!slug) return;
    const nameRu = prompt("Название (RU)") || slug;
    const nameEn = prompt("Name (EN)") || slug;
    const credits = Number(prompt("Кредиты (генераций)") || "0");
    const price = Number(prompt("Цена (₽)") || "0");
    const res = await fetch("/api/admin/packages", {
      method: "POST",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ slug, nameRu, nameEn, credits, price }),
    });
    if (res.ok) router.refresh();
  }

  async function resetDemo() {
    if (!confirm(t("admin_demo_reset"))) return;
    await fetch("/api/admin/reset", { method: "POST", headers: authHeaders() });
    router.refresh();
  }

  return (
    <div className="container" style={{ paddingTop: 40, paddingBottom: 70 }}>
      <h1 style={{ fontSize: 30, fontWeight: 800 }}>{t("admin_title")}</h1>

      <GlobalModelSettings activeProfile={form.active_profile || null} enabled={form.compatible_provider === "genapi" && form.compatible_configured}
        onApplied={next => { setForm(next); setDiagnostics(null); router.refresh(); }} />
      <TelegramSetup />
      <ModelLab styles={styles} enabled={settings.compatible_provider === "genapi" && settings.compatible_configured} />

      {/* Stats */}
      <div className="admin-grid mt">
        <div className="stat-card"><div className="k">{t("admin_stats_users")}</div><div className="v">{stats.users}</div></div>
        <div className="stat-card"><div className="k">{t("admin_stats_generations")}</div><div className="v">{stats.generations}</div></div>
        <div className="stat-card"><div className="k">{t("admin_stats_credits")}</div><div className="v">{stats.credits}</div></div>
        <div className="stat-card"><div className="k">{t("admin_stats_referrals")}</div><div className="v">{stats.referrals}</div></div>
      </div>

      {/* Settings */}
      <div className="panel mt">
        <h2 style={{ fontSize: 19 }}>{t("admin_settings")}</h2>
        <p className="muted small" style={{ marginTop: 6 }}>{t("admin_setting_mode_hint")}</p>
        <div className="field mt">
          <label>{t("admin_setting_mode")}</label>
          <select className="input" value={form.generation_mode} onChange={field("generation_mode")}>
            <option value="demo">demo (предпросмотр)</option>
            <option value="compatible">compatible (агрегатор, сохраняет планировку)</option>
            <option value="replicate">replicate (legacy)</option>
          </select>
        </div>
        <div className="row" style={{ flexWrap: "wrap", gap: 16 }}>
          <div className="field" style={{ flex: 1, minWidth: 180 }}>
            <label>{t("admin_setting_free")}</label>
            <input className="input" type="number" min="0" value={form.free_credits} onChange={field("free_credits")} />
          </div>
          <div className="field" style={{ flex: 1, minWidth: 180 }}>
            <label>{t("admin_setting_reward_tg")}</label>
            <input className="input" type="number" min="0" value={form.reward_telegram} onChange={field("reward_telegram")} />
          </div>
          <div className="field" style={{ flex: 1, minWidth: 180 }}>
            <label>{t("admin_setting_reward_vk")}</label>
            <input className="input" type="number" min="0" value={form.reward_vk} onChange={field("reward_vk")} />
          </div>
          <div className="field" style={{ flex: 1, minWidth: 180 }}>
            <label>{t("admin_setting_reward_ref")}</label>
            <input className="input" type="number" min="0" value={form.reward_referral} onChange={field("reward_referral")} />
          </div>
          <div className="field" style={{ flex: 1, minWidth: 180 }}>
            <label>{t("admin_setting_unlimited")}</label>
            <select className="input" value={form.test_unlimited} onChange={field("test_unlimited")}>
              <option value="1">{t("admin_on")}</option>
              <option value="0">{t("admin_off")}</option>
            </select>
          </div>
        </div>

        <div className="field mt">
          <label htmlFor="daily-free-images">{t("admin_free_daily_limit")}</label>
          <input id="daily-free-images" className="input" type="number" min="0" max="99999" value={form.daily_free_image_limit} onChange={field("daily_free_image_limit")} />
          <p className="small muted">{t("admin_free_daily_help")}</p>
        </div>
        {/* Path #1 aggregator config */}
        <div className="panel mt" style={{ background: "rgba(107,124,255,0.05)", borderColor: "var(--brand)" }}>
          <div className="row" style={{ justifyContent: "space-between" }}>
            <h3 style={{ fontSize: 16 }}>🖼 Агрегатор (путь №1) — сохраняет планировку</h3>
            {form.compatible_configured ? (
              <span className="chip" style={{ color: "var(--success)" }}>✓ {t("admin_configured")}</span>
            ) : (
              <span className="chip" style={{ color: "var(--warn)" }}>✗ {t("admin_not_configured")}</span>
            )}
          </div>
          <p className="muted small" style={{ marginTop: 6 }}>{t("admin_compatible_hint")}</p>
          <div className="field mt">
            <label>{t("admin_compatible_provider")}</label>
            <select className="input" value={form.compatible_provider} onChange={field("compatible_provider")}>
              <option value="genapi">GenAPI (gen-api.ru)</option>
              <option value="openai-compatible">OpenAI-совместимый (provod.ai)</option>
            </select>
          </div>
          <p className="muted small" style={{ marginTop: 6 }}>
            {form.compatible_provider === "genapi"
              ? "GenAPI: ID модели = gpt-image-2 (меняет только стиль, сохраняет планировку) либо nano-banana-pro / nano-banana."
              : "provod.ai: модель = google/nano-banana-pro либо openai/gpt-image-2."}
          </p>
          <div className="row" style={{ flexWrap: "wrap", gap: 16, marginTop: 10 }}>
            <div className="field" style={{ flex: 2, minWidth: 240 }}>
              <label>{t("admin_compatible_base")}</label>
              <input className="input" placeholder="https://api.gen-api.ru" value={form.compatible_base_url} onChange={field("compatible_base_url")} />
            </div>
            <div className="field" style={{ flex: 1, minWidth: 200 }}>
              <label>{t("admin_compatible_model")}</label>
              <input className="input" value={form.compatible_model} onChange={field("compatible_model")} />
            </div>
          </div>
          <div className="field" style={{ marginTop: 12 }}>
            <label>{t("admin_compatible_key")}</label>
            <input className="input" type="password" autoComplete="new-password" placeholder={form.compatible_configured ? "Ключ сохранён — оставьте пустым, чтобы не менять" : "API-ключ"} value={form.compatible_api_key} onChange={field("compatible_api_key")} />
            <p className="small muted" style={{ marginTop: 6 }}>Новый ключ автоматически включает режим compatible. Сохранённый ключ не отображается и не передаётся в браузер.</p>
          </div>
          <div className="small muted">→ {t("admin_compatible_model_list")}: 
            {form.compatible_provider === "genapi" ? (
              <><code>gpt-image-2</code>, <code>nano-banana-pro</code>, <code>nano-banana</code></>
            ) : (
              <><code>google/nano-banana-pro</code>, <code>openai/gpt-image-2</code></>
            )}
          </div>
        </div>

        <div className="row" style={{ marginTop: 16 }}>
          <button className="btn btn-primary" onClick={saveSettings} disabled={saving}>{saving ? "Сохраняем…" : t("admin_save")}</button>
          {msg && <span className="ok" role="status">{msg}</span>}
        </div>
        {error && <p className="err" role="alert" style={{ marginTop: 12 }}>{error}</p>}
      </div>

      {/* AI keys status */}
      <div className="panel mt">
        <h2 style={{ fontSize: 19 }}>ИИ-провайдеры</h2>
        <p className="muted small" style={{ marginTop: 6 }}>{t("admin_token_note")}</p>
        <div className="row" style={{ marginTop: 12, flexWrap: "wrap", gap: 8 }}>
          <span className="chip">{form.compatible_configured ? "✓" : "✗"} Агрегатор (рубли)</span>
          <span className="chip">{env.hasReplicate ? "✓" : "✗"} Replicate</span>
          <span className="chip">{env.hasOpenAI ? "✓" : "✗"} OpenAI</span>
          <span className="chip">{env.hasTogether ? "✓" : "✗"} Together/fal</span>
          <span className="chip">Режим: {form.generation_mode}</span>
        </div>
        <p className="small muted" style={{ marginTop: 12 }}>Проверяется сохранённый ключ и запись/чтение в хранилищах. Сначала сохраните изменения. Платная генерация не запускается; временные тестовые данные удаляются.</p>
        <button className="btn btn-sm" style={{ marginTop: 12 }} onClick={checkGeneration} disabled={probing || saving}>
          {probing ? "Проверяем… (до минуты)" : "Проверить ИИ и хранилища"}
        </button>
        {diagnostics && <pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", marginTop: 12 }} role="status">{diagnostics}</pre>}
      </div>

      {/* Styles */}
      <div className="panel mt">
        <div className="row" style={{ justifyContent: "space-between" }}>
          <h2 style={{ fontSize: 19 }}>{t("admin_styles")}</h2>
          <button className="btn btn-sm" onClick={addStyle}>+ {t("admin_add_style")}</button>
        </div>
        <div className="mt">
          {styles.map((s) => (
            <div key={s.id} className="hist-item">
              <div className="grow">
                <div style={{ fontWeight: 600 }}>{locale === "ru" ? s.nameRu : s.nameEn} <span className="small muted">({s.slug})</span></div>
              </div>
              <button className="btn btn-sm btn-ghost" onClick={() => toggleStyle(s.id, !s.active)}>
                {s.active ? "Вкл" : "Выкл"}
              </button>
              <button className="btn btn-sm btn-danger" onClick={() => delStyle(s.id)}>✕</button>
            </div>
          ))}
        </div>
      </div>

      {/* Packages */}
      <div className="panel mt">
        <div className="row" style={{ justifyContent: "space-between" }}>
          <h2 style={{ fontSize: 19 }}>{t("admin_packages")}</h2>
          <button className="btn btn-sm" onClick={addPackage}>+ {t("admin_add_style")}</button>
        </div>
        <div className="mt">
          {packages.map((p) => (
            <div key={p.id} className="hist-item">
              <div className="grow">
                <div style={{ fontWeight: 600 }}>{locale === "ru" ? p.nameRu : p.nameEn}</div>
                <div className="small muted">{p.credits} {t("credits_label")} · {p.price} ₽</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <button className="btn btn-danger mt" onClick={resetDemo}>↺ {t("admin_demo_reset")}</button>
    </div>
  );
}
