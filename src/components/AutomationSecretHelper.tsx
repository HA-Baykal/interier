"use client";

import { useState } from "react";
import { generateAutomationSecret } from "@/lib/automation-secret";
import { useLocale } from "./locale-context";

/** The value is generated locally on click; never stored, logged, or submitted to our API. */
export default function AutomationSecretHelper() {
  const { t } = useLocale();
  const [secret, setSecret] = useState("");
  const [visible, setVisible] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState(false);
  async function copy(value: string) {
    setCopied(false);
    try { await navigator.clipboard.writeText(value); setCopied(true); }
    catch { /* Keep the masked value available for explicit manual copying. */ }
  }
  function generate() {
    setError(false); setVisible(false); setCopied(false);
    try {
      const value = generateAutomationSecret();
      setSecret(value); void copy(value);
    } catch { setError(true); }
  }
  return <div className="panel mt" id="automation-secret-helper">
    <h3 style={{ fontSize: 16 }}>{t("bypass_helper_title")}</h3>
    <p className="small muted mt">{t("bypass_helper_help")}</p>
    <button type="button" className="btn btn-sm" onClick={generate}>{t("bypass_generate")}</button>
    {secret && <>
      <label htmlFor="local-automation-secret" className="small muted" style={{ display: "block", marginTop: 12 }}>{t("bypass_secret_label")}</label>
      <div className="row" style={{ flexWrap: "wrap", marginTop: 6 }}>
        <input id="local-automation-secret" className="input" type={visible ? "text" : "password"} readOnly autoComplete="off" spellCheck={false}
          value={secret} style={{ flex: 1, minWidth: 200, fontFamily: "monospace" }} onFocus={event => event.target.select()} />
        <button type="button" className="btn btn-sm btn-ghost" onClick={() => void copy(secret)}>{t("bypass_copy")}</button>
        <button type="button" className="btn btn-sm btn-ghost" onClick={() => setVisible(value => !value)}>{t(visible ? "bypass_hide" : "bypass_show")}</button>
        <button type="button" className="btn btn-sm btn-ghost" onClick={() => { setSecret(""); setCopied(false); setVisible(false); }}>{t("bypass_clear")}</button>
      </div>
      <p className="small" role="status">{t(copied ? "bypass_copied" : "bypass_manual_copy")}</p>
    </>}
    {error && <p className="err" role="alert">{t("bypass_crypto_unavailable")}</p>}
    <p className="small muted mt">{t("bypass_privacy")}</p>
  </div>;
}
