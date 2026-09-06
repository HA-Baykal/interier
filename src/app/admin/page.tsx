import { redirect } from "next/navigation";
import Admin from "@/components/Admin";
import AdminBots from "@/components/AdminBots";
import AdminShopping from "@/components/AdminShopping";
import { resolvePageUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { adminSettingsView } from "@/lib/admin-settings";
import { activeStyles, activePackages } from "@/lib/config";
import { ClientPackage, ClientStyle } from "@/components/types";

export default async function AdminPage({
  searchParams,
}: {
  searchParams: { [key: string]: string | string[] | undefined };
}) {
  const query = typeof searchParams.ses === "string" ? searchParams.ses : null;
  const user = await resolvePageUser(query);
  if (!user) redirect("/login");
  if (!user.isAdmin) redirect("/");

  const d = await db();
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
  const packages: ClientPackage[] = (await activePackages()).map((p) => ({
    id: p.id,
    slug: p.slug,
    nameRu: p.name.ru,
    nameEn: p.name.en,
    descRu: p.description.ru,
    descEn: p.description.en,
    credits: p.credits,
    price: p.price,
    badge: p.badge ? (p.badge.ru || p.badge.en) : null,
  }));

  return (
    <>
      <Admin
      stats={{
        users: d.users.length,
        generations: d.generations.length,
        credits: d.users.reduce((a, u) => a + u.credits, 0),
        referrals: d.referrals.filter((r) => r.rewarded).length,
      }}
      settings={adminSettingsView(d)}
      styles={styles}
      packages={packages}
      env={{
        hasReplicate: !!process.env.REPLICATE_API_TOKEN,
        hasOpenAI: !!process.env.OPENAI_API_KEY,
        hasTogether: !!process.env.TOGETHER_API_KEY || !!process.env.FAL_API_KEY,
      }}
      />
      <AdminShopping />
      <AdminBots />
    </>
  );
}
