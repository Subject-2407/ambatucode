import type { Metadata } from "next";
import { BookOpen } from "lucide-react";
import { requirePageSession } from "@/lib/require-page-session";
import { PageContainer, PageHeader } from "@/components/layout/app-shell";
import { EmptyState } from "@/components/ui/empty-state";

export const metadata: Metadata = { title: "Modules" };
export const dynamic = "force-dynamic";

export default async function ArchitectModulesPage() {
  await requirePageSession("ARCHITECT");

  return (
    <PageContainer>
      <PageHeader
        title="Modules"
        description="Modules you own, with their Sections, Materials, and Assessments."
      />
      <EmptyState
        icon={<BookOpen size={28} aria-hidden />}
        title="No Modules yet"
        description="Module authoring arrives with the content phase. Until then this shell confirms your Architect access."
      />
    </PageContainer>
  );
}
