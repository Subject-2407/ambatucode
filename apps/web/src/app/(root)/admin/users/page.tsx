import type { Metadata } from "next";
import { requirePageSession } from "@/lib/require-page-session";
import { UsersScreen } from "./users-screen";

export const metadata: Metadata = { title: "Users" };
export const dynamic = "force-dynamic";

export default async function AdminUsersPage() {
  const session = await requirePageSession("ROOT");
  return <UsersScreen currentUserId={session.user.id} />;
}
