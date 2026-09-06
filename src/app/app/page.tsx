import MiniApp from "@/components/MiniApp";
import { resolvePageUser } from "@/lib/auth";
import { activeStyles } from "@/lib/config";
import { grantedRewards, referralCount } from "@/lib/billing";
import { ClientStyle, ClientUser } from "@/components/types";
import { db } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Container = "telegram" | "vk" | "max" | "web";

function detectContainer(searchParams: Record<string, string | string[] | undefined>, ua: string): Container {
  const hint = typeof searchParams.c === "string" ? searchParams.c.toLowerCase() : "";
  if (hint === "telegram" || hint === "vk" || hint === "max") return hint;
  const s = (ua || "").toLowerCase();
  if (s.includes("telegram")) return "telegram";
  if (s.includes("vkwebapp") || s.includes("vkmobile") || s.includes("vkios") || s.includes("andvk")) return "vk";
  if (s.includes("maxenger") || s.includes("mxsdk") || s.includes(" max/") || s.includes("maxmobile")) return "max";
  // Bot links carry ?link=<token>, whose chat type is stored with the token.
  return typeof searchParams.link === "string" ? "web" : "web";
}

/**
 * The Interier application opened from Telegram / VK / MAX.
 *
 * Auth comes from the messenger (signed initData or a one-time bot link), so the
 * page renders straight into the user's account — no login form for bot users.
 */
export default async function AppPage({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const query = typeof searchParams.ses === "string" ? searchParams.ses : null;
  const user = await resolvePageUser(query || (typeof searchParams.link === "string" ? null : null));
  const container = detectContainer(searchParams, "");

  const styles: ClientStyle[] = (await activeStyles()).map((s) => ({
    id: s.id,
    slug: s.slug,
    nameRu: s.name.ru,
    nameEn: s.name.en,
    descRu: s.description.ru,
    descEn: s.description.en,
    preview: s.preview,
    accent: s.config.accent,
    filter: s.config.filter,
    tint: s.config.tint,
    vignette: s.config.vignette,
    active: s.active,
  }));

  let clientUser: ClientUser | null = null;
  if (user) {
    const rewards = await grantedRewards(user.id);
    clientUser = {
      id: user.id,
      email: user.email,
      name: user.name,
      credits: user.credits,
      trialUsed: user.trialUsed,
      referralCode: user.referralCode,
      referredBy: user.referredBy,
      telegramId: user.telegramId,
      vkId: user.vkId,
      telegramGranted: rewards.telegram,
      vkGranted: rewards.vk,
      isAdmin: user.isAdmin,
      referralCount: await referralCount(user.id),
    };
  } else if (typeof searchParams.link === "string") {
    // A link token is redeemed client-side; show the app shell right away.
    void db();
  }

  return <MiniApp initialUser={clientUser} styles={styles} container={container} />;
}
