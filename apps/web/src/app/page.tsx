import { redirect } from "next/navigation";
import { getSession } from "@/server/auth/session";
import { homePathForRole, routes } from "@/lib/routes";

export const dynamic = "force-dynamic";

/**
 * The root path has no content of its own — it only decides which role's home
 * the visitor belongs on.
 */
export default async function IndexPage() {
  const session = await getSession();
  redirect(session ? homePathForRole(session.user.role) : routes.login);
}
