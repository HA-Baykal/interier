/**
 * Thin, retrying Telegram Bot API transport, shared by the bot adapter, the
 * setup helpers and the polling worker.
 */

export const TELEGRAM_API = "https://api.telegram.org";
export const TELEGRAM_FILE_API = "https://api.telegram.org/file";

/** Call a Bot API method with 429 backoff and forgiving 400s. */
export async function call<T = any>(token: string, method: string, payload: Record<string, unknown>): Promise<T> {
  const url = `${TELEGRAM_API}/bot${token}/${method}`;
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (res.ok) return (await res.json()) as T;
    const text = await res.text().catch(() => "");
    if (res.status === 429) {
      const retry = Number(text.match(/"retry_after"\s*:\s*(\d+)/)?.[1] || 2);
      await new Promise((r) => setTimeout(r, (retry + attempt) * 1000));
      continue;
    }
    // Editing a message to the same content is a no-op, not an error.
    if (res.status === 400 && /not modified|no new content|empty/i.test(text)) return { ok: true } as T;
    throw new Error(`Telegram ${method} failed (${res.status}): ${text.slice(0, 200)}`);
  }
  throw new Error(`Telegram ${method}: too many retries`);
}

/** Same, but resolving the token from the app settings itself. */
export async function tgCall<T = any>(method: string, payload: Record<string, unknown>): Promise<T> {
  const { telegramConfig } = await import("./config");
  const cfg = await telegramConfig();
  if (!cfg.token) throw new Error("TELEGRAM_BOT_TOKEN is not set");
  return call<T>(cfg.token, method, payload);
}
