import type { Metadata } from "next";
import { BookOpen } from "lucide-react";
import { requirePageSession } from "@/lib/require-page-session";
import { PageContainer, PageHeader } from "@/components/layout/app-shell";
import { EmptyState } from "@/components/ui/empty-state";

export const metadata: Metadata = { title: "Dashboard" };
export const dynamic = "force-dynamic";

export default async function CoderDashboardPage() {
  const session = await requirePageSession("CODER");

  return (
    <PageContainer>
      <PageHeader
        title={`Welcome back, ${session.user.displayName}`}
        description="Your Modules and Assessments will appear here."
      />
      <EmptyState
        icon={<BookOpen size={28} aria-hidden />}
        title="No Modules yet"
        description="Once an Architect publishes a Module and you enrol, it shows up on this dashboard."
      />
    </PageContainer>
  );
}
