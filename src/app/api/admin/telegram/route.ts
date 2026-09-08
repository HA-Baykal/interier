import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { assertSameOrigin } from "@/lib/request-origin";
import { RequestError } from "@/lib/errors";
import { connectTelegram, telegramPublicStatus } from "@/lib/telegram/connection";
import { authFailure, privateHeaders } from "@/lib/auth-response";
import { inspectTelegramBot } from "@/lib/telegram/bot-identity";
import { telegramConfig } from "@/lib/telegram/config";
import { fetchTelegramWebhookReport } from "@/lib/telegram/webhook-report";
import { telegramTokenSource } from "@/lib/bots/config";
import { applyTelegramProfile, botAppDiagnostics, telegramWebhookExpectation } from "@/lib/bots/setup";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Live `getWebhookInfo` for the diagnostics screen. Returns `null` when no bot
 * token is configured anywhere — then there is nothing Telegram could tell us.
 */
async function webhookDiagnostics(req: NextRequest) {
  const host = req.headers.get("x-forwarded-host") || req.headers.get("host");
  const source = await telegramTokenSource();
  if (!source) return null;
  const { expectedUrl, originSource } = await telegramWebhookExpectation(host);
  const requestOrigin = host ? `https://${host.replace(/^https?:\/\//, "")}` : null;
  return fetchTelegramWebhookReport({ token: source.token, expectedUrl, requestOrigin, originSource });
}

export async function GET(req: NextRequest) {
  try {
    await requireAdmin(req);
    const probe = req.nextUrl.searchParams.get("probe") === "1";
    const [status, app] = await Promise.all([telegramPublicStatus(), botAppDiagnostics()]);
    let identity: Awaited<ReturnType<typeof inspectTelegramBot>> | undefined;
    let webhook: Awaited<ReturnType<typeof fetchTelegramWebhookReport>> | null = null;
    if (probe) {
      [identity, webhook] = await Promise.all([
        status.configured ? inspectTelegramBot(telegramConfig()) : undefined,
        webhookDiagnostics(req),
      ]);
    }
    return NextResponse.json(
      { ...status, app, ...(identity ? { identity } : {}), ...(webhook ? { webhook } : {}) },
      { headers: privateHeaders }
    );
  }
  catch (e) { return authFailure(e); }
}
export async function POST(req: NextRequest) {
  try {
    assertSameOrigin(req); await requireAdmin(req);
    const data = z.object({ takeOver: z.boolean().default(false), profile: z.boolean().default(false) }).strict().safeParse(await req.json().catch(() => null));
    if (!data.success) throw new RequestError("bad_request", "Некорректный запрос подключения.");
    // `profile` only rewrites what a user reads in the bot's profile (name,
    // «About», commands, Mini App button) — the webhook is left untouched.
    if (data.data.profile) {
      const host = req.headers.get("x-forwarded-host") || req.headers.get("host");
      const [profile, status, app, webhook] = await Promise.all([
        applyTelegramProfile(host), telegramPublicStatus(), botAppDiagnostics(), webhookDiagnostics(req),
      ]);
      return NextResponse.json(
        { ok: true, ...status, app, profile, ...(webhook ? { webhook } : {}) },
        { headers: privateHeaders }
      );
    }
    const status = await connectTelegram(data.data.takeOver);
    const [app, webhook] = await Promise.all([botAppDiagnostics(), webhookDiagnostics(req)]);
    return NextResponse.json({ ok: true, ...status, app, ...(webhook ? { webhook } : {}) }, { headers: privateHeaders });
  } catch (e) { return authFailure(e); }
}
