"use client";

import { useEffect, useRef, useState } from "react";
import { authHeaders, saveToken, withToken } from "@/lib/client-auth";
import { useLocale } from "./locale-context";

type Challenge = { id: string; secret: string; code: string; botUrl: string; expiresAt: number };
export default function TelegramAccess({ purpose = "login", onLinked, referralCode }: { purpose?: "login" | "link"; onLinked?: () => void; referralCode?: string }) {
  const { t } = useLocale();
  const [available, setAvailable] = useState(false);
  const [username, setUsername] = useState("interier_home_bot");
  const [challenge, setChallenge] = useState<Challenge | null>(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [canceling, setCanceling] = useState(false);
  const linked = useRef(onLinked); linked.current = onLinked;
  const startGuard = useRef(false);
  useEffect(() => {
    let alive = true;
    fetch("/api/auth/providers", { cache: "no-store" }).then(r => r.json()).then(data => {
      if (alive) { setAvailable(data.telegram?.available === true); setUsername(data.telegram?.username || "interier_home_bot"); }
    }).catch(() => {});
    return () => { alive = false; };
  }, []);
  useEffect(() => {
    if (!challenge) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    async function poll() {
      if (stopped) return;
      if (Date.now() >= challenge!.expiresAt) { setError(t("tg_expired")); setChallenge(null); return; }
      let wait = 2000;
      try {
        const response = await fetch("/api/auth/telegram/poll", { method: "POST", cache: "no-store", headers: { ...authHeaders(), "Content-Type": "application/json" },
          body: JSON.stringify({ id: challenge!.id, secret: challenge!.secret }), signal: AbortSignal.timeout(15_000) });
        const data = await response.json().catch(() => ({}));
        if (stopped) return;
        if (response.status === 429 || response.status >= 500) { wait = 10_000; }
        else if (!response.ok) { setError(data.message || t("tg_expired")); setChallenge(null); return; }
        else if (data.status === "authenticated" && data.token) {
          saveToken(data.token); window.location.href = withToken("/studio"); return;
        } else if (data.status === "linked") {
          setDone(true); setChallenge(null); linked.current?.(); return;
        } else if (data.status === "denied") {
          setError(t("tg_denied")); setChallenge(null); return;
        }
      } catch { wait = 5000; }
      if (!stopped) timer = setTimeout(poll, wait);
    }
    void poll();
    return () => { stopped = true; if (timer) clearTimeout(timer); };
  }, [challenge, t]);
  async function start() {
    if (startGuard.current || !available) return;
    startGuard.current = true; setStarting(true); setError(null); setDone(false);
    try {
      const response = await fetch("/api/auth/telegram/start", { method: "POST", headers: { ...authHeaders(), "Content-Type": "application/json" }, body: JSON.stringify({ purpose, ...(referralCode ? { referralCode } : {}) }) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.challenge) throw new Error(data.message || t("common_error"));
      setChallenge(data.challenge);
    } catch (e) { setError(e instanceof Error ? e.message : t("common_error")); }
    finally { startGuard.current = false; setStarting(false); }
  }
  async function cancel() {
    if (!challenge || canceling) return;
    setCanceling(true);
    try {
      const response = await fetch("/api/auth/telegram/poll", { method: "POST", headers: { ...authHeaders(), "Content-Type": "application/json" }, body: JSON.stringify({ id: challenge.id, secret: challenge.secret, cancel: true }) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) { setError(data.message || t("common_error")); return; }
      setChallenge(null);
    } catch { setError(t("common_error")); }
    finally { setCanceling(false); }
  }
  return <section className="telegram-access" aria-label={t("tg_login")}>
    {done ? <p className="ok" role="status">{t("tg_linked")}</p> : challenge ? <div className="telegram-challenge">
      <p>{t("tg_compare_code")}</p><strong className="telegram-code">{challenge.code}</strong>
      <a className="btn btn-primary" href={challenge.botUrl} target="_blank" rel="noopener noreferrer">{t("tg_open_bot")} @{username}</a>
      <p className="small muted" role="status">{t("tg_wait")}</p>
      <button className="btn btn-sm btn-ghost" type="button" disabled={canceling} onClick={cancel}>{t("tg_cancel")}</button>
    </div> : <>
      <button className="btn btn-ghost" type="button" disabled={!available || starting} onClick={start} style={{ width: "100%" }}>
        {starting ? t("common_loading") : t(purpose === "link" ? "tg_link" : "tg_login")}
      </button>
      {!available && <p className="small muted">{t("tg_not_ready")}</p>}
    </>}
    {error && <p className="err" role="alert">{error}</p>}
  </section>;
}
