import type { Metadata } from "next";
import { PageContainer, PageHeader } from "@/components/layout/app-shell";
import { AchievementShowcase } from "@/components/gamification/achievement-showcase";
import { requirePageSession } from "@/lib/require-page-session";

export const metadata: Metadata = { title: "Achievements" };
export const dynamic = "force-dynamic";

export default async function AchievementsPage() {
  const session = await requirePageSession("CODER");

  return (
    <PageContainer>
      <PageHeader
        title="Achievements"
        description="Titles you have earned, and the ones still out there. Awards are permanent."
      />
      <AchievementShowcase userId={session.user.id} />
    </PageContainer>
  );
}
