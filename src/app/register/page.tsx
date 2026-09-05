import { redirect } from "next/navigation";
import AuthForm from "@/components/AuthForm";
import { resolvePageUser } from "@/lib/auth";

export default function RegisterPage({
  searchParams,
}: {
  searchParams: { [key: string]: string | string[] | undefined };
}) {
  const query = typeof searchParams.ses === "string" ? searchParams.ses : null;
  if (resolvePageUser(query)) redirect("/studio");
  const ref = typeof searchParams.ref === "string" ? searchParams.ref : undefined;
  return <AuthForm mode="register" initialRef={ref} />;
}
