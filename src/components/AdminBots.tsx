"use client";

/**
 * Admin panel: Telegram Bot & Mini App.
 */

import { useCallback, useEffect, useState } from "react";
import { useLocale } from "./locale-context";
import { authHeaders } from "@/lib/client-auth";

type Platform = "telegram";

type Status = {
  platform: Platform;
  enabled: boolean;
  configured: boolean;
  detail: string | null;
  me?: { username?: string | null; name?: string | null; id?: string | null } | null;
  webhook?: string | null;
  error?: string | null;
};

type BotsResp = {
  baseUrl: string;
  appUrl: string;
  webhookPaths: Record<Platform, string>;
  platforms: Status[];
  stats: { chats?: number; byPlatform?: Record<string, number>; linked?: number; today?: number; [k: string]: unknown };
  chats: { platform: string; chatId: string; user: string; step: string; linked: boolean; updatedAt: number }[];
  raw: Record<string, string>;
};

type OutMsg = { text?: string; photoUrl?: string | null; buttons?: { text: string; kind?: string; url?: string; action?: string }[][] };

type Field = { key: string; label: string; type?: "text" | "password" | "check" | "area" | "number"; hint?: string; placeholder?: string };

const FIELDS: { group: string; icon: string; items: Field[] }[] = [
  {
    group: "bots_group_common",
    icon: "⚙️",
    items: [
      { key: "bots_enabled", label: "bots_enabled_label", type: "check" },
      { key: "bots_inline_generation", label: "bots_inline_label", type: "check", hint: "bots_inline_hint" },
      { key: "bots_simulator", label: "bots_simulator_label", type: "check", hint: "bots_simulator_hint" },
      { key: "public_base_url", label: "bots_base_url", placeholder: "https://interier.example.com", hint: "bots_base_url_hint" },
      { key: "admin_telegram_id", label: "bots_owner_id", placeholder: "123456789", hint: "bots_owner_hint" },
      { key: "bots_link_ttl_min", label: "bots_ttl", type: "number" },
      { key: "bots_poll_secret", label: "bots_poll_secret", type: "password", hint: "bots_poll_secret_hint" },
    ],
  },
  {
    group: "bots_group_telegram",
    icon: "✈️",
    items: [
      { key: "telegram_bot_token", label: "bots_tg_token", type: "password", placeholder: "123456:AA...", hint: "bots_tg_token_hint" },
      { key: "telegram_bot_username", label: "bots_tg_username", placeholder: "interier_design_bot" },
      { key: "telegram_mini_app_url", label: "bots_tg_miniapp", placeholder: "https://…/app", hint: "bots_tg_miniapp_hint" },
      { key: "telegram_webhook_secret", label: "bots_tg_secret", type: "password", hint: "bots_secret_hint" },
      { key: "telegram_channel_id", label: "bots_tg_channel", placeholder: "@interier_design" },
      { key: "channel_telegram_url", label: "bots_channel_url", placeholder: "https://t.me/interier_design" },
    ],
  },
];

export default function AdminBots() {
  const { t, locale } = useLocale();
  const [data, setData] = useState<BotsResp | null>(null);
  const [form, setForm] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [simText, setSimText] = useState("/start");
  const [simOut, setSimOut] = useState<OutMsg[] | null>(null);
  const [simToast, setSimToast] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/bots", { headers: authHeaders() });
      if (!res.ok) {
        setErr(t("admin_bots_load_error"));
        return;
      }
      const d: BotsResp = await res.json();
      setData(d);
      setForm(d.raw || {});
    } catch {
      setErr(t("common_error"));
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  function set(key: string, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function save() {
    setBusy(true);
    setErr(null);
    setMsg(null);
    try {
      const res = await fetch("/api/admin/bots", {
        method: "PUT",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (!res.ok) {
        setErr(t("common_error"));
        return;
      }
      setMsg(t("admin_saved"));
      await load();
      setTimeout(() => setMsg(null), 2500);
    } catch {
      setErr(t("common_error"));
    } finally {
      setBusy(false);
    }
  }

  async function setup(platform?: Platform) {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch("/api/admin/bots/setup", {
        method: "POST",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify(platform ? { platform } : {}),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok || d.ok === false) {
        setErr(String(d.error || t("admin_bots_setup_error")));
      } else {
        setMsg(t("admin_bots_setup_ok"));
        await load();
      }
    } catch {
      setErr(t("common_error"));
    } finally {
      setBusy(false);
    }
  }

  async function simulate() {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch("/api/admin/bots/test", {
        method: "POST",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ platform: "telegram", text: simText, chatId: "admin-test", externalId: "admin-test" }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErr(String(d.error || t("common_error")));
        return;
      }
      setSimOut(d.messages || []);
      setSimToast(d.toast || null);
    } catch {
      setErr(t("common_error"));
    } finally {
      setBusy(false);
    }
  }

  const label = (f: Field) => {
    const v = t(f.label);
    return v === f.label ? f.label : v;
  };

  const botUsername = form.telegram_bot_username?.replace(/^@/, "");

  return (
    <div className="container" style={{ paddingTop: 20, paddingBottom: 40 }}>
      <div className="panel">
        <div className="row" style={{ justifyContent: "space-between", flexWrap: "wrap", gap: 10 }}>
          <div>
            <h2 style={{ fontSize: 19 }}>🤖 {t("admin_bots_title")}</h2>
            <p className="muted small" style={{ marginTop: 6 }}>
              {t("admin_bots_subtitle")}
            </p>
          </div>
          <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
            <button className="btn btn-sm btn-ghost" onClick={load} disabled={busy}>
              🔄 {t("admin_bots_reload")}
            </button>
            <button className="btn btn-sm" onClick={() => setup()} disabled={busy}>
              🔗 {t("admin_bots_setup")}
            </button>
            <button className="btn btn-sm btn-primary" onClick={save} disabled={busy}>
              {t("admin_save")}
            </button>
          </div>
        </div>

        {msg && <div className="ok" style={{ marginTop: 10 }}>{msg}</div>}
        {err && <div className="err" style={{ marginTop: 10 }}>{err}</div>}

        {data && (
          <div className="row" style={{ flexWrap: "wrap", gap: 8, marginTop: 14 }}>
            <span className="chip">🌐 {data.baseUrl || "—"}</span>
            <a className="chip" href={data.appUrl} target="_blank" rel="noreferrer">
              📱 {data.appUrl}
            </a>
            {botUsername && (
              <a className="chip" href={`https://t.me/${botUsername}?startapp=app`} target="_blank" rel="noreferrer">
                ✈️ t.me/{botUsername}?startapp=app
              </a>
            )}
            {Object.entries(data.stats || {}).map(([k, v]) =>
              typeof v === "number" ? (
                <span className="chip" key={k}>
                  {k}: <b>{v}</b>
                </span>
              ) : null
            )}
          </div>
        )}
      </div>

      {/* platform cards */}
      <div className="admin-grid mt">
        {(data?.platforms || []).map((p) => {
          return (
            <div className="stat-card" key={p.platform} style={{ padding: 16 }}>
              <div className="row" style={{ justifyContent: "space-between" }}>
                <b>
                  ✈️ TELEGRAM
                </b>
                <span className="chip">{p.configured && p.enabled ? "✅" : p.configured ? "⏸" : "⚠️"}</span>
              </div>
              <div className="small muted" style={{ marginTop: 8, lineHeight: 1.6 }}>
                {p.me?.username ? `@${p.me.username.replace(/^@/, "")}` : t("admin_bots_not_connected")}
                <br />
                {t("admin_bots_webhook")}: <code>{p.webhook || `${data?.baseUrl || ""}${data?.webhookPaths?.[p.platform] || ""}`}</code>
                <br />
                {t("bots_tg_shared_webhook")}
                {p.detail && (
                  <>
                    <br />
                    {p.detail}
                  </>
                )}
                {p.error && (
                  <>
                    <br />
                    <span style={{ color: "#e66" }}>{p.error}</span>
                  </>
                )}
              </div>
              <button className="btn btn-sm btn-ghost" style={{ marginTop: 10 }} disabled={busy} onClick={() => setup(p.platform)}>
                {t("admin_bots_setup_one", { platform: p.platform })}
              </button>
            </div>
          );
        })}
      </div>

      {/* settings form */}
      {FIELDS.map((group) => (
        <div className="panel mt" key={group.group}>
          <h2 style={{ fontSize: 17 }}>
            {group.icon} {t(group.group)}
          </h2>
          <div className="admin-grid mt" style={{ gap: 12 }}>
            {group.items.map((f) => (
              <div className="field" key={f.key} style={f.type === "check" ? { flexDirection: "row", alignItems: "center", gap: 10 } : undefined}>
                {f.type === "check" ? (
                  <label className="row" style={{ gap: 10, cursor: "pointer", margin: 0 }}>
                    <input
                      type="checkbox"
                      style={{ width: 18, height: 18 }}
                      checked={form[f.key] === "1" || form[f.key] === "true"}
                      onChange={(e) => set(f.key, e.target.checked ? "1" : "0")}
                    />
                    <span>{label(f)}</span>
                  </label>
                ) : (
                  <>
                    <label>{label(f)}</label>
                    {f.type === "area" ? (
                      <textarea className="input" rows={3} value={form[f.key] || ""} placeholder={f.placeholder} onChange={(e) => set(f.key, e.target.value)} />
                    ) : (
                      <input
                        className="input"
                        type={f.type === "number" ? "number" : f.type === "password" ? "password" : "text"}
                        value={form[f.key] || ""}
                        placeholder={f.placeholder}
                        autoComplete="off"
                        onChange={(e) => set(f.key, e.target.value)}
                      />
                    )}
                  </>
                )}
                {f.hint && (
                  <div className="small muted" style={{ marginTop: 4 }}>
                    {t(f.hint)}
                  </div>
                )}
              </div>
            ))}
          </div>
          <div className="row" style={{ marginTop: 14 }}>
            <button className="btn btn-primary btn-sm" onClick={save} disabled={busy}>
              {t("admin_save")}
            </button>
            <span className="small muted">{t("admin_bots_secret_note")}</span>
          </div>
        </div>
      ))}

      {/* simulator */}
      <div className="panel mt">
        <h2 style={{ fontSize: 17 }}>🧪 {t("admin_bots_sim")}</h2>
        <p className="muted small" style={{ marginTop: 6 }}>
          {t("admin_bots_sim_hint")}
        </p>
        <div className="row mt" style={{ flexWrap: "wrap", gap: 10 }}>
          <input
            className="input"
            style={{ flex: 1, minWidth: 220 }}
            value={simText}
            onChange={(e) => setSimText(e.target.value)}
            placeholder="/start · «замени только шторы» · menu"
            onKeyDown={(e) => {
              if (e.key === "Enter") void simulate();
            }}
          />
          <button className="btn btn-sm btn-primary" onClick={simulate} disabled={busy}>
            {t("admin_bots_run")}
          </button>
        </div>
        {simToast && <div className="small muted" style={{ marginTop: 10 }}>🔔 {simToast}</div>}
        {!!simOut?.length && (
          <div className="row" style={{ gap: 12, marginTop: 14, flexWrap: "wrap", alignItems: "flex-start" }}>
            {simOut.map((m, i) => (
              <div key={i} className="sim-bubble">
                {m.photoUrl && <img src={m.photoUrl} alt="" loading="lazy" />}
                {!!m.text && <div style={{ whiteSpace: "pre-wrap" }}>{m.text.replace(/<[^>]+>/g, "")}</div>}
                {!!m.buttons?.length && (
                  <div className="row" style={{ flexWrap: "wrap", gap: 6, marginTop: 8 }}>
                    {m.buttons.flat().map((b, j) => (
                      <span className="chip" key={j} title={b.action || b.url}>
                        {b.text}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
        {!!simOut?.length && (
          <div className="small muted" style={{ marginTop: 8 }}>
            {t("admin_bots_sim_note")}
          </div>
        )}
      </div>

      {/* chats */}
      <div className="panel mt">
        <h2 style={{ fontSize: 17 }}>👥 {t("admin_bots_chats")}</h2>
        {!data?.chats?.length ? (
          <p className="muted small mt">{t("admin_bots_chats_empty")}</p>
        ) : (
          <div className="mt">
            {data.chats.map((c) => (
              <div className="hist-item" key={`${c.platform}:${c.chatId}`}>
                <span className="chip">✈️</span>
                <div className="grow">
                  <div style={{ fontWeight: 600 }}>{c.user}</div>
                  <div className="small muted">
                    {c.chatId} · step: {c.step || "menu"} · {new Date(c.updatedAt).toLocaleString(locale === "ru" ? "ru-RU" : "en-US")}
                  </div>
                </div>
                <span className="chip">{c.linked ? "🔗 " + t("admin_bots_linked") : t("admin_bots_unlinked")}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
