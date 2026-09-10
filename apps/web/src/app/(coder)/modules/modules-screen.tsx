"use client";

import { useMemo, useState } from "react";
import NextLink from "next/link";
import { Flex, Grid, HStack, InputGroup, Stack, Text } from "@chakra-ui/react";
import { BookOpen, Lock, Search } from "lucide-react";
import type { ModuleSummary } from "@ambatucode/shared";
import { PageContainer, PageHeader } from "@/components/layout/app-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { TabBar, type TabItem } from "@/components/ui/tabs";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { useModules } from "@/hooks/use-modules";
import { routes } from "@/lib/routes";
import { EnrollButton } from "./enroll-button";

const PAGE_SIZE = 24;

const SCOPE_TABS: readonly TabItem[] = [
  { value: "catalog", label: "All modules" },
  { value: "enrolled", label: "My modules" },
];

/**
 * The catalog a Coder browses.
 *
 * Closed modules are listed alongside Public ones. Closed governs who may
 * enter, not who may know it exists — hiding them would leave a Coder with no
 * way to ask for the access the SRS says they may request.
 */
export function ModulesScreen() {
  const [scope, setScope] = useState<"catalog" | "enrolled">("catalog");
  const [searchInput, setSearchInput] = useState("");
  const search = useDebouncedValue(searchInput.trim(), 300);

  const query = useMemo(
    () => ({ page: 1, pageSize: PAGE_SIZE, scope, search: search || undefined }),
    [scope, search],
  );
  const { data, isPending, isError, error, refetch } = useModules(query);
  const items = data?.items ?? [];

  return (
    <PageContainer>
      <PageHeader
        title="Modules"
        description="Enroll to read the materials and try the practice activities inside."
      />

      <Stack gap="4">
        <Flex gap="3" direction={{ base: "column", md: "row" }} justify="space-between">
          <TabBar
            items={SCOPE_TABS}
            value={scope}
            onValueChange={(next) => setScope(next as "catalog" | "enrolled")}
            aria-label="Module scope"
          />
          <InputGroup startElement={<Search size={16} aria-hidden />} maxWidth={{ md: "20rem" }}>
            <Input
              placeholder="Search modules"
              value={searchInput}
              onChange={(event) => setSearchInput(event.currentTarget.value)}
              aria-label="Search modules"
            />
          </InputGroup>
        </Flex>

        {isError ? (
          <ErrorState error={error} onRetry={() => void refetch()} />
        ) : isPending ? (
          <Grid
            templateColumns={{ base: "1fr", md: "repeat(2, 1fr)", xl: "repeat(3, 1fr)" }}
            gap="4"
          >
            {Array.from({ length: 6 }, (_, index) => (
              <Skeleton key={index} height="10rem" borderRadius="lg" />
            ))}
          </Grid>
        ) : items.length === 0 ? (
          <EmptyState
            icon={<BookOpen aria-hidden />}
            title={scope === "enrolled" ? "You have not joined a module yet" : "No modules found"}
            description={
              scope === "enrolled"
                ? "Browse all modules and enroll in one to get started."
                : "Nothing matches that search. Try a different word."
            }
            action={
              scope === "enrolled" ? (
                <Button variant="outline" onClick={() => setScope("catalog")}>
                  Browse all modules
                </Button>
              ) : undefined
            }
          />
        ) : (
          <Grid
            templateColumns={{ base: "1fr", md: "repeat(2, 1fr)", xl: "repeat(3, 1fr)" }}
            gap="4"
          >
            {items.map((module) => (
              <ModuleCard key={module.id} module={module} />
            ))}
          </Grid>
        )}
      </Stack>
    </PageContainer>
  );
}

function ModuleCard({ module }: { module: ModuleSummary }) {
  const isClosed = module.visibility === "CLOSED";

  return (
    <Stack
      as="article"
      aria-label={module.title}
      bg="bg.surface"
      borderWidth="1px"
      borderColor="border.default"
      borderRadius="lg"
      padding="5"
      gap="3"
      justify="space-between"
      height="full"
    >
      <Stack gap="2">
        <HStack justify="space-between" align="start" gap="3">
          <Text fontWeight="semibold" fontSize="md" lineClamp={2}>
            {module.title}
          </Text>
          <Badge tone={isClosed ? "warning" : "neutral"} flexShrink="0">
            {isClosed ? (
              <>
                <Lock size={12} aria-hidden /> Closed
              </>
            ) : (
              "Public"
            )}
          </Badge>
        </HStack>

        <Text color="fg.muted" fontSize="sm" lineClamp={3}>
          {module.description ?? "No description yet."}
        </Text>

        <Text color="fg.muted" fontSize="xs">
          {module.owner.displayName} · {module.sectionCount}{" "}
          {module.sectionCount === 1 ? "section" : "sections"}
        </Text>
      </Stack>

      {module.viewer.canRead ? (
        <Button asChild variant="outline" size="sm" alignSelf="start">
          <NextLink href={routes.module(module.slug)}>Open module</NextLink>
        </Button>
      ) : (
        <EnrollButton module={module} size="sm" />
      )}
    </Stack>
  );
}
