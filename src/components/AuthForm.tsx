"use client";

import Link from "next/link";
import { useState } from "react";
import { useLocale } from "./locale-context";
import { saveToken, withToken } from "@/lib/client-auth";

export default function AuthForm({
  mode,
  initialRef,
}: {
  mode: "login" | "register";
  initialRef?: string;
}) {
  const { t } = useLocale();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [refCode, setRefCode] = useState(initialRef ?? "");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const url = mode === "login" ? "/api/auth/login" : "/api/auth/register";
    const body =
      mode === "login"
        ? { email, password }
        : { name, email, password, referralCode: refCode || null };
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.message || t(data.error || "auth_error_fields"));
        return;
      }
      if (!data.token) throw new Error(t("common_error"));
      // SessionStorage/query fallback also supports cookie-blocked preview iframes.
      saveToken(data.token);
      window.location.href = withToken("/studio");
    } catch (e) { setError(e instanceof Error ? e.message : t("common_error")); }
    finally { setLoading(false); }
  }

  return (
    <div className="auth-wrap">
      <div className="panel">
        <h2>{t(mode === "login" ? "auth_login_title" : "auth_register_title")}</h2>
        <div className="sub">{t("tagline")}</div>
        <form onSubmit={submit}>
          {mode === "register" && (
            <div className="field">
              <label>{t("auth_name")}</label>
              <input
                className="input"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                minLength={2}
              />
            </div>
          )}
          <div className="field">
            <label>{t("auth_email")}</label>
            <input
              className="input"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>
          <div className="field">
            <label>{t("auth_password")}</label>
            <input
              className="input"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={6}
            />
          </div>
          {mode === "register" && (
            <div className="field">
              <label>{t("auth_referral_optional")}</label>
              <input
                className="input"
                value={refCode}
                onChange={(e) => setRefCode(e.target.value)}
                placeholder="e.g. IVAN1D34"
              />
            </div>
          )}
          {error && <div className="err" role="alert">{error}</div>}
          <button className="btn btn-primary" style={{ width: "100%", marginTop: 8 }} disabled={loading}>
            {loading ? t("common_loading") : t(mode === "login" ? "auth_login_btn" : "auth_register_btn")}
          </button>
        </form>
        <div className="switcher-note">
          {mode === "login" ? (
            <Link href="/register">{t("auth_to_register")}</Link>
          ) : (
            <Link href="/login">{t("auth_to_login")}</Link>
          )}
        </div>
      </div>
    </div>
  );
}
