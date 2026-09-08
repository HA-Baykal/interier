import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * TON Connect manifest. The SDK requires a public HTTPS URL that describes the
 * dApp; wallets read `name`/`iconUrl` from it. Built from the request origin so
 * it works on any deployment without hardcoding the host.
 */
export async function GET(req: NextRequest) {
  const origin =
    req.headers.get("x-forwarded-origin") ||
    `https://${req.headers.get("x-forwarded-host") || req.headers.get("host")}`;
  return NextResponse.json(
    {
      url: origin,
      name: "Interier",
      iconUrl: `${origin}/icons/icon-192.png`,
    },
    { headers: { "Cache-Control": "public, max-age=3600" } }
  );
}
