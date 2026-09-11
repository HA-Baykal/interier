import { redirect } from "next/navigation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * When /app is opened (from Telegram Menu Button or legacy links),
 * redirect directly to the main landing page with all navigation tabs.
 */
export default async function AppPage({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(searchParams || {})) {
    if (typeof value === "string") {
      params.set(key, value);
    } else if (Array.isArray(value)) {
      for (const v of value) params.append(key, v);
    }
  }
  const qs = params.toString();
  redirect(qs ? `/?${qs}` : "/");
}
