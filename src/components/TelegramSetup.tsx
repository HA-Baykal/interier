"use client";

import { useEffect, useState } from "react";
import { authHeaders } from "@/lib/client-auth";
import { useLocale } from "./locale-context";
import AutomationSecretHelper from "./AutomationSecretHelper";
import type { TelegramBotIdentity } from "@/lib/telegram/bot-identity";
import type { TelegramWebhookReport } from "@/lib/telegram/webhook-report";

type AppDiagnostics = {
  botsEnabled: boolean;
  appEnabled: boolean;
  simulator: boolean;
  inlineGeneration: boolean;
  tokenSource: "panel" | "env" | null;
  name: string | null;
  profileAppliedAt: number | null;
};

type Status = {
  configured: boolean;
  connected: boolean;
  username: string;
  publicOrigin: string | null;
  bypassConfigured: boolean;
  message?: string;
  identity?: TelegramBotIdentity;
  webhook?: TelegramWebhookReport;
  app?: AppDiagnostics;
  profile?: { ok: boolean; applied: string[]; errors: string[]; name: string | null };
};

/**
 * Telegram block of the admin panel.
 *
 * It answers the only question that matters when "the bot behaves like an old
 * version": who owns the webhook right now, is the application half switched
 * on, and does the bot's profile say that it is an app.
 */
export default function TelegramSetup() {
  const { t, locale } = useLocale();
  const [status, setStatus] = useState<Status | null>(null);
  const [busy, setBusy] = useState(false);
  const [probing, setProbing] = useState(false);
  const [takeOver, setTakeOver] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function refresh(probe = false) {
    if (probe) { setProbing(true); setError(null); setMessage(null); }
    try {
      const response = await fetch(`/api/admin/telegram${probe ? "?probe=1" : ""}`, { headers: authHeaders(), cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || `HTTP ${response.status}`);
      setStatus(data);
    } catch (e) { setError(e instanceof Error ? e.message : t("common_error")); }
    finally { if (probe) setProbing(false); }
  }

  useEffect(() => { void refresh(); }, []);

  async function post(body: { takeOver?: boolean; profile?: boolean }, okMessage?: string) {
    if (busy) return;
    setBusy(true); setError(null); setMessage(null);
    try {
      const response = await fetch("/api/admin/telegram", { method: "POST", headers: { ...authHeaders(), "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.ok) throw new Error(data.message || `HTTP ${response.status}`);
      setStatus(data);
      if (data.profile) {
        setMessage(data.profile.errors?.length
          ? `${t("tg_profile_err", { list: data.profile.errors.join("; ") })}`
          : t("tg_profile_ok", { list: data.profile.applied.join(", ") }));
      } else {
        setMessage(okMessage || t("tg_setup_success"));
      }
    } catch (e) { setError(e instanceof Error ? e.message : t("common_error")); }
    finally { setBusy(false); }
  }

  const webhook = status?.webhook;
  const app = status?.app;

  return <section className="panel mt" id="telegram-setup" aria-labelledby="telegram-setup-heading">
    <h2 id="telegram-setup-heading" style={{ fontSize: 23 }}>{t("tg_setup_title")}</h2>
    <p className="small muted mt">{t("tg_setup_help")}</p>
    {status ? <>
      <div className="row mt" style={{ flexWrap: "wrap" }}>
        <span className="chip">@{status.username}</span>
        <span className="chip">{status.configured ? "✓" : "✗"} {t("tg_token_set")}</span>
        <span className="chip">{status.connected ? "✓" : "✗"} {t("tg_webhook_set")}</span>
        {app && <span className="chip">{app.appEnabled ? "✅" : "⛔"} {app.appEnabled ? t("tg_app_on") : t("tg_app_off")}</span>}
        {app?.tokenSource && <span className="chip">{app.tokenSource === "panel" ? t("tg_token_source_panel") : t("tg_token_source_env")}</span>}
        {app?.name && <span className="chip">🏷 {app.name}</span>}
        {app?.simulator && <span className="chip" style={{ color: "#e66" }}>⚠️ {t("tg_simulator_on")}</span>}
      </div>

      {/* webhook diagnostics: who owns the bot right now */}
      {webhook ? <div className="panel mt" id="telegram-webhook-report" role="status">
        <p className="small"><strong>{t("tg_webhook_block")}</strong> — {webhook.ok ? "✅" : "⚠️"} <code>{webhook.code}</code></p>
        <p className="small">{t("tg_webhook_now")}: <code>{webhook.url || t("tg_webhook_none")}</code></p>
        <p className="small">{t("tg_webhook_expected")}: <code>{webhook.expectedUrl || "—"}</code></p>
        {webhook.pendingUpdates > 0 && <p className="small">{t("tg_webhook_pending", { n: webhook.pendingUpdates })}</p>}
        {!!webhook.allowedUpdates?.length && <p className="small muted">{t("tg_webhook_updates")}: {webhook.allowedUpdates.join(", ")}</p>}
        {webhook.hadBypass && <p className="small muted">{t("tg_webhook_bypass")}</p>}
        {webhook.lastError && <p className="small err">{webhook.lastError}{webhook.lastErrorAt ? ` · ${new Date(webhook.lastErrorAt).toLocaleString(locale === "ru" ? "ru-RU" : "en-US")}` : ""}</p>}
        <p className={webhook.ok ? "ok small" : "err small"} style={{ whiteSpace: "pre-wrap" }}>{webhook.message}</p>
      </div> : <p className="small muted mt">{t("tg_diagnose_hint")}</p>}

      {status.identity && <div className="panel mt" id="telegram-identity-report" role="status">
        <p className="small">{t("tg_expected_bot")}: <strong>@{status.identity.expectedUsername}</strong></p>
        <p className="small">{t("tg_reported_bot")}: <strong>{status.identity.actualUsername ? `@${status.identity.actualUsername}` : "—"}</strong></p>
        <p className={status.identity.matches ? "ok small" : "err small"}>{status.identity.message}</p>
      </div>}

      {app?.profileAppliedAt ? <p className="small muted mt">{t("tg_profile_applied_at", { when: new Date(app.profileAppliedAt).toLocaleString(locale === "ru" ? "ru-RU" : "en-US") })}</p> : null}
      {status.publicOrigin && <p className="small muted mt">{t("tg_server_address")}: {status.publicOrigin}</p>}
      {!status.configured && <p className="small err">{status.message}</p>}
      {status.configured && !status.bypassConfigured && <p className="small muted mt">{t("tg_protection_help")}</p>}
      {!status.bypassConfigured && <AutomationSecretHelper />}
      <label className="small muted mt" style={{ display: "block" }}><input type="checkbox" checked={takeOver} onChange={event => setTakeOver(event.target.checked)} disabled={busy || probing} /> {t("tg_takeover")}</label>
      <div className="row mt" style={{ flexWrap: "wrap" }}>
        <button className="btn btn-ghost" type="button" onClick={() => void refresh(true)} disabled={busy || probing || !status.configured}>{probing ? t("common_loading") : t("tg_webhook_check")}</button>
        <button className="btn btn-primary" type="button" onClick={() => void post({ takeOver })} disabled={busy || probing || !status.configured || !status.publicOrigin}>{busy ? t("common_loading") : t("tg_connect")}</button>
        <button className="btn btn-ghost" type="button" onClick={() => void post({ profile: true })} disabled={busy || probing}>{t("tg_profile_apply")}</button>
        <button className="btn btn-ghost" type="button" onClick={() => void refresh()} disabled={busy || probing}>{t("tg_refresh")}</button>
      </div>
    </> : <p className="muted mt">{t("common_loading")}</p>}
    {error && <p className="err mt" role="alert">{error}</p>}
    {message && <p className="ok mt" role="status">{message}</p>}
  </section>;
}
