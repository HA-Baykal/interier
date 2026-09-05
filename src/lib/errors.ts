import { cleanConnectionValue } from "./env";

export class RequestError extends Error {
  constructor(public code: string, message: string, public status = 400) {
    super(message);
  }
}

/** Never return a stack, credentials, image data or signed URLs to the browser. */
export function safeErrorMessage(error: unknown, secrets: string[] = []): string {
  let message = error instanceof Error ? error.message : String(error || "Unknown error");
  const envSecrets = Object.entries(process.env)
    .filter(([name]) => /(?:TOKEN|SECRET|PASSWORD|API_KEY)$/.test(name))
    .flatMap(([, value]) => value ? [value, cleanConnectionValue(value)] : []);
  for (const secret of [...secrets, ...envSecrets].filter(Boolean).sort((a, b) => b.length - a.length)) {
    message = message.split(secret).join("[redacted]");
  }
  return message
    .replace(/Bearer\s+[^\s"',;]+/gi, "Bearer [redacted]")
    // OIDC credentials may come from request context, not process.env.
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, "[redacted]")
    .replace(/data:image\/[^\s"']+/gi, "[image]")
    .replace(/https?:\/\/[^\s"'<>]+/gi, "[URL]")
    .replace(/[\x00-\x1f\x7f]/g, " ")
    .slice(0, 500);
}

export async function providerHttpError(res: Response, context: string, secret: string): Promise<Error> {
  const text = await res.text().catch(() => "");
  let detail = "";
  try {
    const body = JSON.parse(text);
    const value = body.message ?? body.error?.message ?? body.error ?? body.detail ?? body.errors;
    detail = typeof value === "string" ? value : value ? JSON.stringify(value) : "";
  } catch {
    // A hosting/proxy HTML error is not useful (and may include request details).
    detail = text.trim().startsWith("<") ? "provider returned HTML instead of JSON" : text.slice(0, 1000);
  }
  return new Error(safeErrorMessage(`${context} failed (${res.status})${detail ? `: ${detail}` : ""}`, [secret]));
}
