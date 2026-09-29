"use client";

import { useId, useMemo, useState } from "react";
import NextLink from "next/link";
import { Flex, Grid, InputGroup, Stack, Text } from "@chakra-ui/react";
import { Search } from "lucide-react";
import type { ModuleSummary } from "@ambatucode/shared";
import { PageContainer, PageHeader } from "@/components/layout/app-shell";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { Input } from "@/components/ui/input";
import { PixelFrame } from "@/components/ui/pixel-frame";
import { Skeleton } from "@/components/ui/skeleton";
import { TabBar, TabPanel, type TabItem } from "@/components/ui/tabs";
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
  const panelId = useId();

  const query = useMemo(
    () => ({ page: 1, pageSize: PAGE_SIZE, scope, search: search || undefined }),
    [scope, search],
  );
  const { data, isPending, isError, error, refetch } = useModules(query);
  const items = data?.items ?? [];

  return (
    <PageContainer width="wide" backdrop="grid">
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
            controls={panelId}
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

        <TabPanel id={panelId} value={scope}>
          {isError ? (
            <ErrorState error={error} onRetry={() => void refetch()} />
          ) : isPending ? (
            <Grid
              templateColumns={{ base: "1fr", md: "repeat(2, 1fr)", xl: "repeat(3, 1fr)" }}
              gap="4"
            >
              {Array.from({ length: 6 }, (_, index) => (
                <Skeleton key={index} height="10rem" />
              ))}
            </Grid>
          ) : items.length === 0 ? (
            <EmptyState
              sprite="books"
              title={scope === "enrolled" ? "You have not joined a module yet" : "No modules found"}
              description={
                scope === "enrolled"
                  ? "Browse all modules and enroll in one."
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
        </TabPanel>
      </Stack>
    </PageContainer>
  );
}

function ModuleCard({ module }: { module: ModuleSummary }) {
  return (
    // A notched frame rather than a 1px rectangle. Every other surface in the
    // product wears the pixel edge, and the catalog — the screen a Coder spends
    // the most time in before they are enrolled anywhere — was the one place
    // still drawing plain boxes.
    //
    // No Public or Closed badge: the button at the foot of the card already
    // says "Enroll" or "Request access", which is the same fact phrased as what
    // to do about it.
    <PixelFrame as="article" aria-label={module.title} height="full" pad="5">
      <Stack gap="3" justify="space-between" height="full">
        <Stack gap="2">
          <Text textStyle="display" fontSize="md" lineClamp={2}>
            {module.title}
          </Text>

          {module.description ? (
            <Text color="fg.muted" fontSize="sm" lineClamp={3}>
              {module.description}
            </Text>
          ) : null}

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
    </PixelFrame>
  );
}
