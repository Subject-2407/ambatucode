import type { Metadata } from "next";
import NextLink from "next/link";
import { Flex, Grid, HStack, Stack, Text } from "@chakra-ui/react";
import { BookOpen, ChevronRight } from "lucide-react";
import { requirePageSession } from "@/lib/require-page-session";
import { PageContainer, PageHeader } from "@/components/layout/app-shell";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
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
    <PageContainer>
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
          icon={<BookOpen size={28} aria-hidden />}
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
            <Stack
              key={module.id}
              asChild
              borderWidth="1px"
              borderColor="border.default"
              borderRadius="lg"
              bg="bg.surface"
              padding="4"
              gap="1"
              _hover={{ borderColor: "accent.solid" }}
            >
              <NextLink href={routes.module(module.slug)}>
                <Flex justify="space-between" align="center" gap="3">
                  <HStack gap="2" minWidth="0">
                    <BookOpen size={16} aria-hidden />
                    <Text fontWeight="medium" truncate>
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
          ))}
        </Grid>
      )}
    </PageContainer>
  );
}
