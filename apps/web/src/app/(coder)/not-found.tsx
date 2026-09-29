import NextLink from "next/link";
import { PageContainer } from "@/components/layout/app-shell";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { routes } from "@/lib/routes";

/**
 * A Module, Material, or submission that is not there — or not the Coder's to
 * know about, which the services deliberately answer the same way.
 *
 * Inside the shell, with the rail still there. The framework's default was a
 * bare black-on-white page with no way back but the browser's Back button.
 */
export default function CoderNotFound() {
  return (
    <PageContainer width="reading">
      <EmptyState
        sprite="doc"
        title="Nothing here"
        description="This page does not exist, or it is not available to you."
        action={
          <Button asChild>
            <NextLink href={routes.dashboard}>Go to the dashboard</NextLink>
          </Button>
        }
      />
    </PageContainer>
  );
}
