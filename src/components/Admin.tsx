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
  yookassa_enabled?: string;
  yookassa_shop_id?: string;
  yookassa_secret_key?: string;
  yookassa_test_mode?: string;
  yookassa_configured?: boolean;
};

type Env = { hasReplicate: boolean; hasOpenAI: boolean; hasTogether: boolean };

type Stats = { users: number; generations: number; credits: number; referrals: number };

type PackageModalState = {
  mode: "add" | "edit";
  pkg: {
    id?: string;
    slug: string;
    nameRu: string;
    nameEn: string;
    descRu: string;
    descEn: string;
    credits: number;
    price: number;
    badgeRu: string;
    badgeEn: string;
    active: boolean;
  };
} | null;

export default function Admin({
  stats,
  settings,
  styles,
  packages: initialPackages,
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
  const [packs, setPacks] = useState<ClientPackage[]>(initialPackages);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pkgToast, setPkgToast] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [probing, setProbing] = useState(false);
  const [diagnostics, setDiagnostics] = useState<string | null>(null);
  const [pkgModal, setPkgModal] = useState<PackageModalState>(null);
  const [pkgSaving, setPkgSaving] = useState(false);
  const [copiedWebhook, setCopiedWebhook] = useState(false);

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

  /* --- Styles --- */
  async function toggleStyle(id: string, active: boolean) {
    await fetch(`/api/admin/styles/${id}`, {
      method: "PATCH",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ active }),
    });
    router.refresh();
  }

  async function delStyle(id: string) {
    if (!confirm("Удалить стиль?")) return;
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

  /* --- Packages (Manual Price & Credit management) --- */
  function showToast(text: string) {
    setPkgToast(text);
    setTimeout(() => setPkgToast(null), 3500);
  }

  function handlePackageLocalChange(id: string, field: "price" | "credits", val: number) {
    setPacks((prev) =>
      prev.map((p) => (p.id === id ? { ...p, [field]: val } : p))
    );
  }

  async function saveQuickPackage(pkg: ClientPackage) {
    try {
      const res = await fetch(`/api/admin/packages/${pkg.id}`, {
        method: "PATCH",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({
          price: pkg.price,
          credits: pkg.credits,
          active: pkg.active,
        }),
      });
      if (!res.ok) throw new Error("Failed to save");
      showToast(`✓ Пакет «${pkg.nameRu || pkg.slug}»: ${pkg.price} ₽ (${pkg.credits} генераций) сохранён`);
      router.refresh();
    } catch {
      showToast("Ошибка сохранения пакета");
    }
  }

  async function togglePackageActive(pkg: ClientPackage) {
    const nextActive = !pkg.active;
    setPacks((prev) =>
      prev.map((p) => (p.id === pkg.id ? { ...p, active: nextActive } : p))
    );
    try {
      const res = await fetch(`/api/admin/packages/${pkg.id}`, {
        method: "PATCH",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ active: nextActive }),
      });
      if (!res.ok) throw new Error("Failed to toggle");
      showToast(`Пакет «${pkg.nameRu || pkg.slug}» ${nextActive ? "включён" : "отключён"}`);
      router.refresh();
    } catch {
      showToast("Ошибка изменения статуса пакета");
    }
  }

  async function delPackage(id: string, name: string) {
    if (!confirm(`Удалить пакет «${name}»?`)) return;
    try {
      const res = await fetch(`/api/admin/packages/${id}`, { method: "DELETE", headers: authHeaders() });
      if (!res.ok) throw new Error("Failed to delete");
      setPacks((prev) => prev.filter((p) => p.id !== id));
      showToast(`Пакет «${name}» удалён`);
      router.refresh();
    } catch {
      showToast("Ошибка удаления пакета");
    }
  }

  function openEditModal(pkg: ClientPackage) {
    setPkgModal({
      mode: "edit",
      pkg: {
        id: pkg.id,
        slug: pkg.slug,
        nameRu: pkg.nameRu,
        nameEn: pkg.nameEn,
        descRu: pkg.descRu,
        descEn: pkg.descEn,
        credits: pkg.credits,
        price: pkg.price,
        badgeRu: pkg.badgeRu || "",
        badgeEn: pkg.badgeEn || "",
        active: pkg.active,
      },
    });
  }

  function openAddModal() {
    setPkgModal({
      mode: "add",
      pkg: {
        slug: "",
        nameRu: "",
        nameEn: "",
        descRu: "",
        descEn: "",
        credits: 10,
        price: 990,
        badgeRu: "",
        badgeEn: "",
        active: true,
      },
    });
  }

  async function submitPackageModal() {
    if (!pkgModal) return;
    setPkgSaving(true);
    const { mode, pkg } = pkgModal;
    try {
      if (mode === "add") {
        const res = await fetch("/api/admin/packages", {
          method: "POST",
          headers: { ...authHeaders(), "Content-Type": "application/json" },
          body: JSON.stringify(pkg),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.ok) throw new Error(data.error || "Failed to create package");
        showToast(`✓ Пакет «${pkg.nameRu || pkg.slug}» успешно создан (${pkg.price} ₽)`);
      } else {
        const res = await fetch(`/api/admin/packages/${pkg.id}`, {
          method: "PATCH",
          headers: { ...authHeaders(), "Content-Type": "application/json" },
          body: JSON.stringify(pkg),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.ok) throw new Error(data.error || "Failed to update package");
        showToast(`✓ Пакет «${pkg.nameRu || pkg.slug}» обновлён (${pkg.price} ₽)`);
      }
      setPkgModal(null);
      // Reload packages from server
      const r = await fetch("/api/admin/packages", { headers: authHeaders() });
      if (r.ok) {
        const data = await r.json();
        if (Array.isArray(data.packages)) {
          setPacks(
            data.packages.map((p: any) => ({
              id: p.id,
              slug: p.slug,
              nameRu: p.name.ru,
              nameEn: p.name.en,
              descRu: p.description?.ru || "",
              descEn: p.description?.en || "",
              credits: p.credits,
              price: p.price,
              badgeRu: p.badge?.ru || null,
              badgeEn: p.badge?.en || null,
              badge: p.badge ? (p.badge.ru || p.badge.en) : null,
              active: p.active,
            }))
          );
        }
      }
      router.refresh();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Ошибка сохранения пакета");
    } finally {
      setPkgSaving(false);
    }
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

      {/* YooKassa & Online Payments */}
      <div className="panel mt">
        <div className="row" style={{ justifyContent: "space-between", flexWrap: "wrap", gap: 10 }}>
          <div>
            <h2 style={{ fontSize: 19 }}>💳 {t("admin_yookassa_title")}</h2>
            <p className="muted small" style={{ marginTop: 4 }}>
              {t("admin_yookassa_desc")}
            </p>
          </div>
          <div>
            {form.yookassa_enabled === "0" ? (
              <span className="chip">{t("admin_yookassa_status_off")}</span>
            ) : form.yookassa_configured && form.yookassa_test_mode !== "1" ? (
              <span className="chip" style={{ color: "var(--success)" }}>{t("admin_yookassa_status_live")}</span>
            ) : (
              <span className="chip" style={{ color: "var(--warn)" }}>{t("admin_yookassa_status_test")}</span>
            )}
          </div>
        </div>

        <div className="row" style={{ flexWrap: "wrap", gap: 16, marginTop: 16 }}>
          <div className="field" style={{ flex: 1, minWidth: 200 }}>
            <label>{t("admin_yookassa_enabled")}</label>
            <select className="input" value={form.yookassa_enabled || "1"} onChange={field("yookassa_enabled")}>
              <option value="1">{t("admin_on")}</option>
              <option value="0">{t("admin_off")}</option>
            </select>
          </div>
          <div className="field" style={{ flex: 1, minWidth: 200 }}>
            <label>{t("admin_yookassa_test_mode")}</label>
            <select className="input" value={form.yookassa_test_mode || "0"} onChange={field("yookassa_test_mode")}>
              <option value="0">{t("admin_off")} (Боевой приём оплат)</option>
              <option value="1">{t("admin_on")} (Песочница / Тест)</option>
            </select>
          </div>
        </div>

        <div className="row" style={{ flexWrap: "wrap", gap: 16, marginTop: 12 }}>
          <div className="field" style={{ flex: 1, minWidth: 220 }}>
            <label>{t("admin_yookassa_shop_id")}</label>
            <input
              className="input"
              placeholder="Например, 381928"
              value={form.yookassa_shop_id || ""}
              onChange={field("yookassa_shop_id")}
            />
          </div>
          <div className="field" style={{ flex: 2, minWidth: 260 }}>
            <label>{t("admin_yookassa_secret_key")}</label>
            <input
              className="input"
              type="password"
              autoComplete="new-password"
              placeholder={form.yookassa_configured ? "Ключ сохранён — оставьте пустым, чтобы не менять" : "live_... или test_..."}
              value={form.yookassa_secret_key || ""}
              onChange={field("yookassa_secret_key")}
            />
          </div>
        </div>

        {/* Webhook copy box */}
        <div className="mt" style={{ padding: "12px 14px", background: "rgba(255,255,255,0.03)", borderRadius: 8, border: "1px solid rgba(255,255,255,0.07)" }}>
          <div style={{ fontWeight: 600, fontSize: 14 }}>🔗 {t("admin_yookassa_webhook_title")}</div>
          <div className="row" style={{ marginTop: 8, gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <input
              className="input"
              style={{ flex: 1, minWidth: 260, fontSize: 13, background: "rgba(0,0,0,0.3)" }}
              readOnly
              value={typeof window !== "undefined" ? `${window.location.origin}/api/payments/yookassa/webhook` : "/api/payments/yookassa/webhook"}
            />
            <button
              className="btn btn-sm btn-ghost"
              onClick={() => {
                const url = `${window.location.origin}/api/payments/yookassa/webhook`;
                navigator.clipboard?.writeText(url);
                setCopiedWebhook(true);
                setTimeout(() => setCopiedWebhook(false), 2000);
              }}
            >
              {copiedWebhook ? "✓ Скопировано" : "Скопировать URL"}
            </button>
          </div>
          <p className="small muted" style={{ marginTop: 6 }}>
            {t("admin_yookassa_webhook_hint")}
          </p>
        </div>

        <div className="row" style={{ marginTop: 14 }}>
          <button className="btn btn-primary btn-sm" onClick={saveSettings} disabled={saving}>
            {saving ? "Сохраняем…" : t("admin_save")}
          </button>
        </div>
      </div>

      {/* Packages & Manual Price Management */}
      <div className="panel mt">
        <div className="row" style={{ justifyContent: "space-between", flexWrap: "wrap", gap: 10 }}>
          <div>
            <h2 style={{ fontSize: 19 }}>💳 {t("admin_packages")}</h2>
            <p className="muted small" style={{ marginTop: 4 }}>
              {t("admin_packages_subtitle")}
            </p>
          </div>
          <button className="btn btn-sm btn-primary" onClick={openAddModal}>
            + {t("admin_add_package")}
          </button>
        </div>

        {pkgToast && (
          <div className="ok mt" style={{ padding: "8px 12px", fontSize: 14 }}>
            {pkgToast}
          </div>
        )}

        <div className="mt" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {packs.map((p) => {
            const isFeatured = !!(p.badgeRu || p.badgeEn || p.badge);
            const badgeText = p.badgeRu || p.badgeEn || p.badge;
            return (
              <div
                key={p.id}
                className="panel"
                style={{
                  padding: "14px 18px",
                  background: p.active ? "var(--panel)" : "rgba(255,255,255,0.02)",
                  opacity: p.active ? 1 : 0.65,
                  border: isFeatured ? "1px solid var(--brand)" : undefined,
                }}
              >
                <div className="row" style={{ justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
                  {/* Left info */}
                  <div style={{ minWidth: 200, flex: "1 1 240px" }}>
                    <div className="row" style={{ gap: 8, alignItems: "center" }}>
                      <span style={{ fontSize: 17, fontWeight: 700 }}>
                        {locale === "ru" ? p.nameRu : p.nameEn}
                      </span>
                      <span className="chip" style={{ fontSize: 12 }}>
                        slug: {p.slug}
                      </span>
                      {badgeText && (
                        <span className="badge" style={{ position: "static", fontSize: 11 }}>
                          {badgeText}
                        </span>
                      )}
                    </div>
                    {(p.descRu || p.descEn) && (
                      <div className="small muted" style={{ marginTop: 4 }}>
                        {locale === "ru" ? p.descRu || p.descEn : p.descEn || p.descRu}
                      </div>
                    )}
                  </div>

                  {/* Editable fields */}
                  <div className="row" style={{ alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                    {/* Credits */}
                    <div className="row" style={{ alignItems: "center", gap: 6 }}>
                      <label className="small muted" style={{ margin: 0 }}>Генераций:</label>
                      <input
                        className="input"
                        type="number"
                        min="1"
                        style={{ width: 75, padding: "6px 8px", textAlign: "center", fontWeight: 700 }}
                        value={p.credits}
                        onChange={(e) =>
                          handlePackageLocalChange(p.id, "credits", Math.max(1, parseInt(e.target.value) || 1))
                        }
                      />
                    </div>

                    {/* Price in Rubles */}
                    <div className="row" style={{ alignItems: "center", gap: 6 }}>
                      <label className="small muted" style={{ margin: 0, fontWeight: 600 }}>Цена (₽):</label>
                      <input
                        className="input"
                        type="number"
                        min="0"
                        step="10"
                        style={{
                          width: 105,
                          padding: "6px 8px",
                          textAlign: "right",
                          fontWeight: 800,
                          color: "var(--brand)",
                          fontSize: 16,
                        }}
                        value={p.price}
                        onChange={(e) =>
                          handlePackageLocalChange(p.id, "price", Math.max(0, parseInt(e.target.value) || 0))
                        }
                      />
                      <span style={{ fontWeight: 700, color: "var(--brand)" }}>₽</span>
                    </div>

                    {/* Quick Save button */}
                    <button
                      className="btn btn-sm btn-primary"
                      onClick={() => saveQuickPackage(p)}
                      title="Сохранить цену и генерации"
                    >
                      💾 {t("admin_package_save")}
                    </button>

                    {/* Active toggle */}
                    <button
                      className={"btn btn-sm " + (p.active ? "btn-ghost" : "")}
                      onClick={() => togglePackageActive(p)}
                      style={{
                        minWidth: 55,
                        borderColor: p.active ? "var(--success)" : undefined,
                        color: p.active ? "var(--success)" : undefined,
                      }}
                    >
                      {p.active ? t("admin_on") : t("admin_off")}
                    </button>

                    {/* Edit Modal */}
                    <button
                      className="btn btn-sm btn-ghost"
                      onClick={() => openEditModal(p)}
                      title="Полное редактирование"
                    >
                      ✏️
                    </button>

                    {/* Delete */}
                    <button
                      className="btn btn-sm btn-danger"
                      onClick={() => delPackage(p.id, p.nameRu || p.slug)}
                      title={t("admin_package_delete")}
                    >
                      ✕
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Package Edit/Add Modal */}
      {pkgModal && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: "rgba(0,0,0,0.75)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
            padding: 16,
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget && !pkgSaving) setPkgModal(null);
          }}
        >
          <div
            className="panel"
            style={{
              width: "100%",
              maxWidth: 540,
              maxHeight: "90vh",
              overflowY: "auto",
              padding: 24,
            }}
          >
            <div className="row" style={{ justifyContent: "space-between", marginBottom: 16 }}>
              <h2 style={{ fontSize: 20 }}>
                {pkgModal.mode === "add" ? `+ ${t("admin_add_package")}` : `✏️ ${t("admin_package_edit")}`}
              </h2>
              <button
                className="btn btn-sm btn-ghost"
                disabled={pkgSaving}
                onClick={() => setPkgModal(null)}
              >
                ✕
              </button>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <div className="field">
                <label>Slug (идентификатор, латиница):</label>
                <input
                  className="input"
                  placeholder="e.g. premium"
                  value={pkgModal.pkg.slug}
                  onChange={(e) =>
                    setPkgModal({
                      ...pkgModal,
                      pkg: { ...pkgModal.pkg, slug: e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, "") },
                    })
                  }
                />
              </div>

              <div className="row" style={{ gap: 12 }}>
                <div className="field" style={{ flex: 1 }}>
                  <label>{t("admin_package_name_ru")}:</label>
                  <input
                    className="input"
                    placeholder="Например: Плюс"
                    value={pkgModal.pkg.nameRu}
                    onChange={(e) =>
                      setPkgModal({
                        ...pkgModal,
                        pkg: { ...pkgModal.pkg, nameRu: e.target.value },
                      })
                    }
                  />
                </div>
                <div className="field" style={{ flex: 1 }}>
                  <label>{t("admin_package_name_en")}:</label>
                  <input
                    className="input"
                    placeholder="e.g. Plus"
                    value={pkgModal.pkg.nameEn}
                    onChange={(e) =>
                      setPkgModal({
                        ...pkgModal,
                        pkg: { ...pkgModal.pkg, nameEn: e.target.value },
                      })
                    }
                  />
                </div>
              </div>

              <div className="row" style={{ gap: 12 }}>
                <div className="field" style={{ flex: 1 }}>
                  <label>{t("admin_package_price")} (руб.):</label>
                  <input
                    className="input"
                    type="number"
                    min="0"
                    step="10"
                    placeholder="490"
                    style={{ fontWeight: 800, color: "var(--brand)" }}
                    value={pkgModal.pkg.price}
                    onChange={(e) =>
                      setPkgModal({
                        ...pkgModal,
                        pkg: { ...pkgModal.pkg, price: Math.max(0, parseInt(e.target.value) || 0) },
                      })
                    }
                  />
                </div>
                <div className="field" style={{ flex: 1 }}>
                  <label>{t("admin_package_credits")}:</label>
                  <input
                    className="input"
                    type="number"
                    min="1"
                    placeholder="15"
                    style={{ fontWeight: 700 }}
                    value={pkgModal.pkg.credits}
                    onChange={(e) =>
                      setPkgModal({
                        ...pkgModal,
                        pkg: { ...pkgModal.pkg, credits: Math.max(1, parseInt(e.target.value) || 1) },
                      })
                    }
                  />
                </div>
              </div>

              <div className="field">
                <label>{t("admin_package_desc_ru")}:</label>
                <textarea
                  className="input"
                  rows={2}
                  placeholder="15 генераций. Хватит обновить несколько комнат."
                  value={pkgModal.pkg.descRu}
                  onChange={(e) =>
                    setPkgModal({
                      ...pkgModal,
                      pkg: { ...pkgModal.pkg, descRu: e.target.value },
                    })
                  }
                />
              </div>

              <div className="field">
                <label>{t("admin_package_desc_en")}:</label>
                <textarea
                  className="input"
                  rows={2}
                  placeholder="15 generations. Enough to refresh several rooms."
                  value={pkgModal.pkg.descEn}
                  onChange={(e) =>
                    setPkgModal({
                      ...pkgModal,
                      pkg: { ...pkgModal.pkg, descEn: e.target.value },
                    })
                  }
                />
              </div>

              <div className="row" style={{ gap: 12 }}>
                <div className="field" style={{ flex: 1 }}>
                  <label>Бейдж RU (напр. Популярный):</label>
                  <input
                    className="input"
                    placeholder="Популярный"
                    value={pkgModal.pkg.badgeRu}
                    onChange={(e) =>
                      setPkgModal({
                        ...pkgModal,
                        pkg: { ...pkgModal.pkg, badgeRu: e.target.value },
                      })
                    }
                  />
                </div>
                <div className="field" style={{ flex: 1 }}>
                  <label>Badge EN (e.g. Popular):</label>
                  <input
                    className="input"
                    placeholder="Popular"
                    value={pkgModal.pkg.badgeEn}
                    onChange={(e) =>
                      setPkgModal({
                        ...pkgModal,
                        pkg: { ...pkgModal.pkg, badgeEn: e.target.value },
                      })
                    }
                  />
                </div>
              </div>

              <div className="field" style={{ flexDirection: "row", alignItems: "center", gap: 10, marginTop: 4 }}>
                <label className="row" style={{ gap: 10, cursor: "pointer", margin: 0 }}>
                  <input
                    type="checkbox"
                    style={{ width: 18, height: 18 }}
                    checked={pkgModal.pkg.active}
                    onChange={(e) =>
                      setPkgModal({
                        ...pkgModal,
                        pkg: { ...pkgModal.pkg, active: e.target.checked },
                      })
                    }
                  />
                  <span>{t("admin_package_active")}</span>
                </label>
              </div>

              <div className="row" style={{ justifyContent: "flex-end", gap: 10, marginTop: 16 }}>
                <button
                  className="btn btn-ghost"
                  disabled={pkgSaving}
                  onClick={() => setPkgModal(null)}
                >
                  Отмена
                </button>
                <button
                  className="btn btn-primary"
                  disabled={pkgSaving || !pkgModal.pkg.slug || !pkgModal.pkg.nameRu}
                  onClick={submitPackageModal}
                >
                  {pkgSaving ? "Сохраняем…" : t("admin_package_save")}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <button className="btn btn-danger mt" onClick={resetDemo}>↺ {t("admin_demo_reset")}</button>
    </div>
  );
}
