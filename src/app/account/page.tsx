import { isIdentityVerified } from "@/lib/identity";
import { redirect } from "next/navigation";
import Account from "@/components/Account";
import { resolvePageUser } from "@/lib/auth";
import { referralCount, grantedRewards } from "@/lib/billing";

export default async function AccountPage({
  searchParams,
}: {
  searchParams: { [key: string]: string | string[] | undefined };
}) {
  const query = typeof searchParams.ses === "string" ? searchParams.ses : null;
  const user = await resolvePageUser(query);
  if (!user) redirect("/login");
  const rewards = await grantedRewards(user.id);
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
        vkId: user.vkId,
        telegramGranted: rewards.telegram,
        vkGranted: rewards.vk,
        isAdmin: user.isAdmin,
        verified: isIdentityVerified(user),
        telegramLinked: !!user.verifiedIdentities?.some(identity => identity.provider === "telegram"),
        referralCount: await referralCount(user.id),
      }}
    />
  );
}
