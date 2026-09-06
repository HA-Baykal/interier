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

/**
 * Extract error text, not an entire provider response/request. In particular,
 * GenAPI's `error: true` is a flag; `parameter`, `code` and validation messages
 * carry the useful information. Boolean/number flags must never mask those.
 */
export function providerErrorDetail(body: unknown, secrets: string[] = []): string {
  const parts = new Set<string>();
  const seen = new Set<object>();
  let visited = 0;
  const text = (value: unknown): string => typeof value === "string" && !/^(?:true|false|null)$/i.test(value.trim())
    ? value.trim() : "";
  const scalar = (value: unknown): string => typeof value === "number" && Number.isFinite(value) ? String(value) : text(value);
  const add = (value: string, field = "") => {
    if (!value || parts.size >= 6) return;
    const message = value.trim().startsWith("<") ? "provider returned HTML instead of JSON" : value;
    // Redact BEFORE truncating, including keys or image URLs echoed in a validation error.
    parts.add(safeErrorMessage(field ? `${field}: ${message}` : message, secrets));
  };
  const messageKeys = ["message", "messages", "msg", "description", "detail", "details", "error_description", "error_message", "reason", "error"];
  const ignoredFields = new Set(["input", "request", "headers", "authorization", "payload", "data", "stack", "trace", "user", "account", "balance", "email", "phone", "password", "token", "api_key", "type", "status", "code", "error_code", "parameter", "param", "field", "loc", "full_response"]);
  const visit = (value: unknown, field = "", fieldMap = false, depth = 0): void => {
    if (value == null || depth > 5 || parts.size >= 6 || ++visited > 64) return;
    if (typeof value === "string") { add(text(value), field); return; }
    if (!value || typeof value !== "object" || seen.has(value)) return;
    seen.add(value);
    if (Array.isArray(value)) {
      for (const item of value.slice(0, 8)) visit(item, field, fieldMap, depth + 1);
      return;
    }
    const obj = value as Record<string, unknown>;
    const location = Array.isArray(obj.loc) ? obj.loc.map(scalar).filter(Boolean).join(".") : "";
    const parameter = scalar(obj.parameter) || scalar(obj.param) || scalar(obj.field) || location;
    const label = field || parameter;
    const before = parts.size;
    // Prefer field-specific validation errors over a generic "validation failed" summary.
    for (const key of ["errors", "validation_errors"]) visit(obj[key], label, true, depth + 1);
    for (const key of messageKeys) visit(obj[key], label, ["error", "messages", "details", "detail"].includes(key), depth + 1);
    if (fieldMap && parts.size === before) {
      for (const [key, item] of Object.entries(obj).slice(0, 12)) {
        if (!ignoredFields.has(key.toLowerCase()) && !messageKeys.includes(key)) visit(item, field ? `${field}.${key}` : key, true, depth + 1);
      }
    }
    if (parameter && parts.size === before) add(parameter, "Parameter");
    const code = scalar(obj.code) || scalar(obj.error_code);
    if (code) add(code, "Code");
    // Polling responses can nest the real failure under full_response or data.
    // Only inspect error fields there, never stringify the provider's whole payload.
    visit(obj.full_response, "", false, depth + 1);
    if (obj.data && typeof obj.data === "object") visit(obj.data, "", false, depth + 1);
  };
  visit(body);
  return parts.size ? safeErrorMessage([...parts].join("; "), secrets) : "";
}

export async function providerHttpError(res: Response, context: string, secret: string): Promise<Error> {
  const text = await res.text().catch(() => "");
  let detail = "";
  try {
    detail = providerErrorDetail(JSON.parse(text), [secret]);
  } catch {
    const trimmed = text.trim();
    // Do not echo proxy HTML or malformed/truncated JSON containing request data.
    detail = trimmed.startsWith("<") ? "provider returned HTML instead of JSON"
      : ["{", "[", '\"'].some((start) => trimmed.startsWith(start)) ? "provider returned invalid JSON"
      : trimmed ? safeErrorMessage(trimmed, [secret]) : "";
  }
  if (!detail) detail = res.status === 422
    ? "Провайдер отклонил параметры запроса, но не передал пояснение."
    : "Провайдер не передал пояснение ошибки.";
  return new Error(safeErrorMessage(`${context} failed (${res.status}): ${detail}`, [secret]));
}
