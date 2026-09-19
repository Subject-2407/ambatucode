import type { Metadata } from "next";
import NextLink from "next/link";
import { Flex, Grid, HStack, Stack, Text } from "@chakra-ui/react";
import { ChevronRight } from "lucide-react";
import { requirePageSession } from "@/lib/require-page-session";
import { PageContainer, PageHeader } from "@/components/layout/app-shell";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { PixelFrame } from "@/components/ui/pixel-frame";
import { PixelIcon } from "@/components/ui/pixel-icon";
import { routes } from "@/lib/routes";
import { listModules } from "@/server/services/modules";

export const metadata: Metadata = { title: "Dashboard" };
export const dynamic = "force-dynamic";

/** Where a Coder lands: the modules they belong to, and a way to find more. */
export default async function CoderDashboardPage() {
  const session = await requirePageSession("CODER");
  const enrolled = await listModules(session.user, {
    page: 1,
    pageSize: 12,
    scope: "enrolled",
  });

  return (
    <PageContainer backdrop="circuit">
      <PageHeader
        title={`Welcome back, ${session.user.displayName}`}
        description="Your modules, and the practice waiting inside them."
        action={
          <Button asChild variant="outline">
            <NextLink href={routes.modules}>Browse modules</NextLink>
          </Button>
        }
      />

      {enrolled.items.length === 0 ? (
        <EmptyState
          sprite="books"
          title="No modules yet"
          description="Enroll in a module and it appears here."
          action={
            <Button asChild>
              <NextLink href={routes.modules}>Browse modules</NextLink>
            </Button>
          }
        />
      ) : (
        <Grid templateColumns={{ base: "1fr", md: "repeat(2, 1fr)" }} gap="4">
          {enrolled.items.map((module) => (
            // Hovering recolours the frame's edge rather than adding a shadow:
            // the outer layer of a PixelFrame *is* the border.
            <PixelFrame key={module.id} _hover={{ bg: "accent.solid" }}>
              <Stack asChild padding="4" gap="1">
                <NextLink href={routes.module(module.slug)}>
                  <Flex justify="space-between" align="center" gap="3">
                    <HStack gap="2.5" minWidth="0">
                      <PixelIcon name="books" size={16} />
                      <Text textStyle="display" fontSize="sm" truncate>
                        {module.title}
                      </Text>
                    </HStack>
                    <ChevronRight size={16} aria-hidden />
                  </Flex>
                  <Text fontSize="xs" color="fg.muted">
                    {module.sectionCount} {module.sectionCount === 1 ? "section" : "sections"}
                  </Text>
                </NextLink>
              </Stack>
            </PixelFrame>
          ))}
        </Grid>
      )}
    </PageContainer>
  );
}
