import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, AuthError } from "@/lib/auth";
import { getGenerationSettings } from "@/lib/generation/settings";
import { probeCompatible } from "@/lib/generation/diagnostics";
import { safeErrorMessage } from "@/lib/errors";
import { storageStatus, probeStorage } from "@/lib/storage-diagnostics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
const headers = { "Cache-Control": "private, no-store" };

export async function GET(req: NextRequest) {
  try {
    await requireAdmin(req);
    const settings = await getGenerationSettings();
    const cfg = settings.compatible;
    let baseUrl = "invalid";
    try { const url = new URL(cfg.baseUrl); baseUrl = `${url.origin}${url.pathname}`; } catch { /* reported by probe */ }
    const probeRequested = req.nextUrl.searchParams.get("probe") === "1";
    const [probe, storageChecks] = probeRequested ? await Promise.all([
      cfg.apiKey ? probeCompatible(cfg) : Promise.resolve({ ok: false, keyAccepted: false, message: "API-ключ не задан." }),
      probeStorage(),
    ]) : [null, null];
    return NextResponse.json({
      mode: settings.mode, aiConfigured: settings.aiConfigured, isDemo: settings.mode === "demo",
      provider: cfg.provider, baseUrl, model: cfg.model,
      keyConfigured: !!cfg.apiKey, keySource: settings.keySource,
      storage: storageStatus(),
      storageChecks,
      deployment: { environment: process.env.VERCEL_ENV || "local", commit: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 12) || null },
      probe,
    }, { headers });
  } catch (e) {
    return NextResponse.json({ error: e instanceof AuthError ? e.code : "diagnostics_failed", message: e instanceof AuthError ? "Admin access required" : safeErrorMessage(e) }, { status: e instanceof AuthError ? 403 : 503, headers });
  }
}
