import type { NextRequest } from "next/server";
import { RequestError } from "./errors";

/** Reject browser cross-site mutations; authenticated native/server clients may omit Origin. */
export function assertSameOrigin(req: NextRequest): void {
  const origin = req.headers.get("origin");
  if (!origin) return;
  let parsed: URL;
  try { parsed = new URL(origin); } catch { throw new RequestError("origin_forbidden", "Запрос с другого сайта запрещён.", 403); }
  const hosts = [req.nextUrl.host, req.headers.get("host")].filter(Boolean).map(host => host!.toLowerCase());
  if (!["https:", "http:"].includes(parsed.protocol) || !hosts.includes(parsed.host.toLowerCase())) {
    throw new RequestError("origin_forbidden", "Запрос с другого сайта запрещён.", 403);
  }
}
