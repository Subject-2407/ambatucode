import type { Metadata } from "next";
import { cookies } from "next/headers";
import type { ModuleDetail } from "@ambatucode/shared";
import { PageContainer, PageHeader } from "@/components/layout/app-shell";
import { EmptyState } from "@/components/ui/empty-state";
import { MODULE_VIEW_COOKIE, parseModuleView } from "@/lib/module-view";
import { handlePageError } from "@/lib/page-errors";
import { requirePageSession } from "@/lib/require-page-session";
import { getModule } from "@/server/services/modules";
import { EnrollButton } from "../enroll-button";
import { ModuleOverview } from "./module-overview";

export const metadata: Metadata = { title: "Module" };
export const dynamic = "force-dynamic";

type PageProps = { params: Promise<{ moduleSlug: string }> };

/**
 * The Module a Coder opens.
 *
 * Fetched in the Server Component rather than through the API client: this is
 * the first paint of the page, and a loopback HTTP request to our own route
 * handler would only add a round trip and a cookie to forward.
 *
 * The layout preference is read here too, from its cookie, so the page arrives
 * already in the Coder's chosen layout rather than switching to it after load.
 */
export default async function ModuleOverviewPage({ params }: PageProps) {
  const session = await requirePageSession("CODER");
  const { moduleSlug } = await params;

  const module = await getModule(session.user, { slug: moduleSlug }).catch((error: unknown) =>
    handlePageError(error),
  );

  if (!module.viewer.canRead) return <AccessPanel module={module} />;

  const view = parseModuleView((await cookies()).get(MODULE_VIEW_COOKIE)?.value);
  return <ModuleOverview module={module} viewerId={session.user.id} initialView={view} />;
}

/**
 * What a Coder sees before they belong to the module. The tree is absent
 * because the server did not send it, not because it was filtered here.
 */
function AccessPanel({ module }: { module: ModuleDetail }) {
  const pending = module.viewer.enrollmentStatus === "PENDING";

  return (
    <PageContainer width="reading" backdrop="constellation">
      <PageHeader title={module.title} description={module.description ?? undefined} />
      <EmptyState
        sprite="lock"
        title={pending ? "Waiting for approval" : "Enroll to read this module"}
        description={
          pending
            ? "The Architect has your request. The materials open as soon as it is approved."
            : undefined
        }
        action={<EnrollButton module={module} />}
      />
    </PageContainer>
  );
}
