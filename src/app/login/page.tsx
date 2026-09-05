import { redirect } from "next/navigation";
import AuthForm from "@/components/AuthForm";
import { resolvePageUser } from "@/lib/auth";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: { [key: string]: string | string[] | undefined };
}) {
  const query = typeof searchParams.ses === "string" ? searchParams.ses : null;
  if (await resolvePageUser(query)) redirect("/studio");
  return <AuthForm mode="login" />;
}
