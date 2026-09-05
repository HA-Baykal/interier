"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useLocale } from "./locale-context";
import { authHeaders } from "@/lib/client-auth";
import { ClientPackage, ClientStyle } from "./types";

type Settings = {
  generation_mode: string;
  free_credits: string;
  reward_telegram: string;
  reward_vk: string;
  reward_referral: string;
  test_unlimited: string;
  compatible_base_url: string;
  compatible_api_key: string;
  compatible_model: string;
  compatible_configured: boolean;
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

  function field(key: keyof Settings) {
    return (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      setForm((f) => ({ ...f, [key]: e.target.value }));
  }

  async function saveSettings() {
    const res = await fetch("/api/admin/settings", {
      method: "PUT",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    const data = await res.json();
    if (data.ok) {
      setMsg(t("admin_saved"));
      setTimeout(() => setMsg(null), 2200);
    }
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
          <div className="row" style={{ flexWrap: "wrap", gap: 16, marginTop: 10 }}>
            <div className="field" style={{ flex: 2, minWidth: 240 }}>
              <label>{t("admin_compatible_base")}</label>
              <input className="input" placeholder="https://api.provod.ai/v1" value={form.compatible_base_url} onChange={field("compatible_base_url")} />
            </div>
            <div className="field" style={{ flex: 1, minWidth: 200 }}>
              <label>{t("admin_compatible_model")}</label>
              <input className="input" value={form.compatible_model} onChange={field("compatible_model")} />
            </div>
          </div>
          <div className="field" style={{ marginTop: 12 }}>
            <label>{t("admin_compatible_key")}</label>
            <input className="input" type="password" placeholder="••••••••" value={form.compatible_api_key} onChange={field("compatible_api_key")} />
          </div>
          <div className="small muted">→ {t("admin_compatible_model_list")}: <code>google/nano-banana</code>, <code>openai/gpt-image-2</code></div>
        </div>

        <div className="row" style={{ marginTop: 16 }}>
          <button className="btn btn-primary" onClick={saveSettings}>{t("admin_save")}</button>
          {msg && <span className="ok">{msg}</span>}
        </div>
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
