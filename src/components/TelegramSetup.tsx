"use client";

import { useEffect, useState } from "react";
import { authHeaders } from "@/lib/client-auth";
import { useLocale } from "./locale-context";
import AutomationSecretHelper from "./AutomationSecretHelper";
import type { TelegramBotIdentity } from "@/lib/telegram/bot-identity";

type Status = { configured: boolean; connected: boolean; username: string; publicOrigin: string | null; bypassConfigured: boolean; message?: string; identity?: TelegramBotIdentity };
export default function TelegramSetup() {
  const { t } = useLocale();
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
  async function connect() {
    if (busy) return;
    setBusy(true); setError(null); setMessage(null);
    try {
      const response = await fetch("/api/admin/telegram", { method: "POST", headers: { ...authHeaders(), "Content-Type": "application/json" }, body: JSON.stringify({ takeOver }) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.ok) throw new Error(data.message || `HTTP ${response.status}`);
      setStatus(data); setMessage(t("tg_setup_success"));
    } catch (e) { setError(e instanceof Error ? e.message : t("common_error")); }
    finally { setBusy(false); }
  }
  return <section className="panel mt" id="telegram-setup" aria-labelledby="telegram-setup-heading">
    <h2 id="telegram-setup-heading" style={{ fontSize: 23 }}>{t("tg_setup_title")}</h2>
    <p className="small muted mt">{t("tg_setup_help")}</p>
    {status ? <>
      <div className="row mt" style={{ flexWrap: "wrap" }}>
        <span className="chip">@{status.username}</span>
        <span className="chip">{status.configured ? "✓" : "✗"} {t("tg_token_set")}</span>
        <span className="chip">{status.connected ? "✓" : "✗"} {t("tg_webhook_set")}</span>
      </div>
      {status.identity && <div className="panel mt" id="telegram-identity-report" role="status">
        <p className="small">{t("tg_expected_bot")}: <strong>@{status.identity.expectedUsername}</strong></p>
        <p className="small">{t("tg_reported_bot")}: <strong>{status.identity.actualUsername ? `@${status.identity.actualUsername}` : "—"}</strong></p>
        <p className={status.identity.matches ? "ok small" : "err small"}>{status.identity.message}</p>
      </div>}
      {status.publicOrigin && <p className="small muted mt">{t("tg_server_address")}: {status.publicOrigin}</p>}
      {!status.configured && <p className="small err">{status.message}</p>}
      {status.configured && !status.bypassConfigured && <p className="small muted mt">{t("tg_protection_help")}</p>}
      {!status.bypassConfigured && <AutomationSecretHelper />}
      <label className="small muted mt" style={{ display: "block" }}><input type="checkbox" checked={takeOver} onChange={event => setTakeOver(event.target.checked)} disabled={busy || probing} /> {t("tg_takeover")}</label>
      <div className="row mt" style={{ flexWrap: "wrap" }}>
        <button className="btn btn-ghost" type="button" onClick={() => void refresh(true)} disabled={busy || probing || !status.configured}>{probing ? t("common_loading") : t("tg_check_bot")}</button>
        <button className="btn btn-primary" type="button" onClick={connect} disabled={busy || probing || !status.configured || !status.publicOrigin}>{busy ? t("common_loading") : t("tg_connect")}</button>
        <button className="btn btn-ghost" type="button" onClick={() => void refresh()} disabled={busy || probing}>{t("tg_refresh")}</button>
      </div>
    </> : <p className="muted mt">{t("common_loading")}</p>}
    {error && <p className="err mt" role="alert">{error}</p>}
    {message && <p className="ok mt" role="status">{message}</p>}
  </section>;
}
