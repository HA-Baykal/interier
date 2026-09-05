import fs from "fs";
import path from "path";
import { db } from "./db";

/**
 * Temporary diagnostics to capture exactly what headers / cookies the server
 * sees on auth calls when running under the Arena preview proxy. This lets us
 * confirm the root cause of the persistent login loop without guessing.
 */
export function logAuthDiag(req: Request, label: string) {
  try {
    const h = req.headers as unknown as Record<string, string | string[] | undefined>;
    const get = (k: string) => {
      const v = h[k.toLowerCase()] ?? h[k] ?? req.headers.get(k) ?? "";
      return Array.isArray(v) ? v.join(",") : String(v);
    };
    const line = {
      at: new Date().toISOString(),
      label,
      proto: req.headers.get("x-forwarded-proto"),
      host: req.headers.get("host"),
      xhost: req.headers.get("x-forwarded-host"),
      cfVisitor: get("cf-visitor"),
      secFetchSite: req.headers.get("sec-fetch-site"),
      cookie: req.headers.get("cookie") ? "<has-cookie>" : "<none>",
      userId: (() => {
        try {
          // No async here; just parse the cookie for the session token.
          const c = req.headers.get("cookie") || "";
          const m = c.match(/interier_session=([^;]+)/);
          if (!m) return null;
          const s = db().sessions.find((x) => x.token === m[1]);
          return s?.userId ?? "session-not-found";
        } catch {
          return "err";
        }
      })(),
    };
    const file = path.join(process.cwd(), "data", "auth-diag.log");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, JSON.stringify(line) + "\n");
  } catch {
    /* diagnostics must never break the app */
  }
}
