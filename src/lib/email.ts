import { getSetting } from "./config";

/**
 * Transactional email (registration confirmation codes).
 *
 * HTTP-only (no SMTP — Vercel blocks the SMTP ports), so it works on serverless.
 * Providers: Resend, Brevo, Unisender Go (go1/go2/goapi) and classic Unisender
 * (app.unisender.com). Key/sender are read from settings first (admin panel) and
 * fall back to env. When nothing is configured the call reports `configured:false`
 * so the caller can decide whether to block or fall back.
 */
export type EmailSendResult = { ok: boolean; configured: boolean; error?: string };

async function creds(): Promise<{
  provider: string; key: string; from: string; fromEmail: string;
  unisenderBase: string; unisenderListId: string;
}> {
  const provider = (await getSetting("email_provider")) || (process.env.EMAIL_PROVIDER || "resend");
  const isUnisender = provider === "unisender" || provider === "unisender_classic";
  const key =
    provider === "brevo"
      ? (await getSetting("brevo_api_key")) || process.env.BREVO_API_KEY || ""
      : isUnisender
        ? (await getSetting("unisender_api_key")) || process.env.UNISENDER_API_KEY || ""
        : (await getSetting("resend_api_key")) || process.env.RESEND_API_KEY || "";
  const fromEmail =
    (await getSetting("email_from")) || process.env.EMAIL_FROM || "no-reply@interier.app";
  // Unisender Go: аккаунт привязан к серверу (go1/go2/goapi). Неверный хост даёт
  // «user not found» (код 114), поэтому адрес API настраивается.
  const unisenderBase = ((await getSetting("unisender_base_url")) || process.env.UNISENDER_BASE_URL || "https://goapi.unisender.ru/ru/transactional/api/v1").replace(/\/+$/, "");
  // Classic Unisender: sendEmail шлётся «от имени» списка рассылки — list_id обязателен.
  const unisenderListId = (await getSetting("unisender_list_id")) || process.env.UNISENDER_LIST_ID || "";
  return { provider, key, from: `Interier <${fromEmail}>`, fromEmail, unisenderBase, unisenderListId };
}

export async function isEmailConfigured(): Promise<boolean> {
  return !!(await creds()).key;
}

const SUBJECT = "Interier — код подтверждения регистрации";

/** Send a registration confirmation code. */
export async function sendConfirmationCode(to: string, code: string): Promise<EmailSendResult> {
  const { provider, key, from, fromEmail, unisenderBase, unisenderListId } = await creds();
  if (!key) return { ok: false, configured: false, error: "email_not_configured" };
  const text =
    `Ваш код подтверждения регистрации в Interier: ${code}\n\nЕсли вы не регистрировались, просто проигнорируйте это письмо.`;
  const html = `<div style="font-family:sans-serif;font-size:16px;line-height:1.5"><p>Ваш код подтверждения регистрации в <b>Interier</b>:</p><p style="font-size:28px;font-weight:700;letter-spacing:4px">${code}</p><p style="color:#666;font-size:13px">Если вы не регистрировались, просто проигнорируйте это письмо.</p></div>`;
  try {
    if (provider === "unisender") {
      // Unisender Go (go1/go2/goapi): X-API-KEY, message{...}. Нужен подтверждённый домен-отправитель.
      const res = await fetch(`${unisenderBase}/email/send.json`, {
        method: "POST",
        headers: { "X-API-KEY": key, "Content-Type": "application/json" },
        body: JSON.stringify({
          message: {
            recipients: [{ email: to }],
            from_email: fromEmail,
            from_name: "Interier",
            subject: SUBJECT,
            body: { plaintext: text, html },
          },
        }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || (json as any)?.status === "error") {
        return { ok: false, configured: true, error: String((json as any)?.message || (json as any)?.code || res.status) };
      }
      return { ok: true, configured: true };
    }
    if (provider === "unisender_classic") {
      // Классический Unisender (app.unisender.com): api.unisender.com/ru/api/sendEmail.
      if (!unisenderListId) return { ok: false, configured: true, error: "unisender_list_id_required" };
      const params = new URLSearchParams({
        api_key: key, email: to, sender_name: "Interier", sender_email: fromEmail,
        subject: SUBJECT, body: html, list_id: unisenderListId, error_checking: "1",
      });
      const res = await fetch("https://api.unisender.com/ru/api/sendEmail?format=json", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: params.toString(),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || (json as any)?.status === "error" || (json as any)?.error) {
        return { ok: false, configured: true, error: String((json as any)?.message || (json as any)?.error || (json as any)?.code || res.status) };
      }
      return { ok: true, configured: true };
    }
    if (provider === "brevo") {
      const res = await fetch("https://api.brevo.com/v3/smtp/emails", {
        method: "POST",
        headers: { "api-key": key, "Content-Type": "application/json" },
        body: JSON.stringify({
          sender: { email: fromEmail, name: "Interier" },
          to: [{ email: to }],
          subject: SUBJECT,
          textContent: text,
        }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) return { ok: false, configured: true, error: String((json as any)?.message || res.status) };
      return { ok: true, configured: true };
    }
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to: [to], subject: SUBJECT, text }),
    });
    const json = await res.json().catch(() => null);
    if (!res.ok) return { ok: false, configured: true, error: String((json as any)?.message || res.status) };
    return { ok: true, configured: true };
  } catch (e) {
    return { ok: false, configured: true, error: e instanceof Error ? e.message : String(e) };
  }
}

/** 6-digit code, zero-padded, crypto-random. */
export function makeCode(): string {
  const n = crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000;
  return String(n).padStart(6, "0");
}
