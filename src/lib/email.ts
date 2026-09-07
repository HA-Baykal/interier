import { getSetting } from "./config";

/**
 * Transactional email (registration confirmation codes).
 *
 * Uses Resend over HTTP — no SMTP, works on Vercel. The key and sender are read
 * from settings first (owner can set them in the admin panel) and fall back to
 * env. When nothing is configured the call reports `configured:false` so the
 * caller can decide whether to block or fall back.
 */
export type EmailSendResult = { ok: boolean; configured: boolean; error?: string };

async function creds(): Promise<{ key: string; from: string }> {
  const key =
    (await getSetting("resend_api_key")) || process.env.RESEND_API_KEY || "";
  const from =
    (await getSetting("email_from")) ||
    process.env.EMAIL_FROM ||
    "Interier <no-reply@interier.app>";
  return { key, from };
}

export async function isEmailConfigured(): Promise<boolean> {
  return !!(await creds()).key;
}

/** Send a registration confirmation code. Plain-text body, no markup tricks. */
export async function sendConfirmationCode(to: string, code: string): Promise<EmailSendResult> {
  const { key, from } = await creds();
  if (!key) return { ok: false, configured: false, error: "email_not_configured" };
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from,
        to: [to],
        subject: "Interier — код подтверждения регистрации",
        text: `Ваш код подтверждения регистрации в Interier: ${code}\n\nЕсли вы не регистрировались, просто проигнорируйте это письмо.`,
      }),
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
