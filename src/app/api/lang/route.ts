import { NextRequest, NextResponse } from "next/server";
import { setLocale } from "@/lib/locale";
import { isSecureRequest } from "@/lib/auth";
import { Locale } from "@/lib/types";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const locale: Locale = body?.locale === "en" ? "en" : "ru";
  // Match the SameSite policy of the session cookie so the preference also
  // persists inside the cross-site preview iframe.
  setLocale(locale, isSecureRequest(req));
  return NextResponse.json({ ok: true, locale });
}
