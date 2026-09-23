import type { Metadata } from "next";
import { requirePageSession } from "@/lib/require-page-session";
import { PageContainer, PageHeader } from "@/components/layout/app-shell";
import { ProfileScreen } from "./profile-screen";

export const metadata: Metadata = { title: "Profile" };
export const dynamic = "force-dynamic";

export default async function CoderProfilePage() {
  const { user, expiresAt } = await requirePageSession("CODER");

  return (
    <PageContainer backdrop="circuit">
      <PageHeader
        title="Profile"
        description="Your account details, and the Titles you have earned."
      />
      <ProfileScreen user={user} expiresAt={expiresAt.toISOString()} />
    </PageContainer>
  );
}
