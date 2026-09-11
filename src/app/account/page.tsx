import { isIdentityVerified } from "@/lib/identity";
import { redirect } from "next/navigation";
import Account from "@/components/Account";
import { resolvePageUser } from "@/lib/auth";
import { referralCount, grantedRewards } from "@/lib/billing";
import { activePackages } from "@/lib/config";
import { ClientPackage } from "@/components/types";

export default async function AccountPage({
  searchParams,
}: {
  searchParams: { [key: string]: string | string[] | undefined };
}) {
  const query = typeof searchParams.ses === "string" ? searchParams.ses : null;
  const user = await resolvePageUser(query);
  if (!user) redirect("/login");
  const rewards = await grantedRewards(user.id);
  const packages: ClientPackage[] = (await activePackages()).map((p) => ({
    id: p.id,
    slug: p.slug,
    nameRu: p.name.ru,
    nameEn: p.name.en,
    descRu: p.description?.ru || "",
    descEn: p.description?.en || "",
    credits: p.credits,
    price: p.price,
    badgeRu: p.badge?.ru || "",
    badgeEn: p.badge?.en || "",
    active: p.active,
  }));

  return (
    <Account
      initialUser={{
        id: user.id,
        email: user.email,
        name: user.name,
        credits: user.credits,
        trialUsed: user.trialUsed,
        referralCode: user.referralCode,
        referredBy: user.referredBy,
        telegramId: user.telegramId,
        telegramGranted: rewards.telegram,
        isAdmin: user.isAdmin,
        verified: isIdentityVerified(user),
        telegramLinked: !!user.verifiedIdentities?.some(identity => identity.provider === "telegram"),
        referralCount: await referralCount(user.id),
      }}
      packages={packages}
    />
  );
}
