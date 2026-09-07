import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getSession } from "@/server/auth/session";
import { homePathForRole } from "@/lib/routes";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in" };
export const dynamic = "force-dynamic";

type PageProps = { searchParams: Promise<{ reason?: string }> };

export default async function LoginPage({ searchParams }: PageProps) {
  const session = await getSession();
  if (session) {
    redirect(homePathForRole(session.user.role));
  }

  const { reason } = await searchParams;
  return <LoginForm supersededNotice={reason === "superseded"} />;
}
