"use client";

import { useMemo, useState } from "react";
import NextLink from "next/link";
import { Box, Grid, HStack, Stack } from "@chakra-ui/react";
import { ChevronLeft, UserCheck } from "lucide-react";
import { PageContainer, PageHeader } from "@/components/layout/app-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/ui/error-state";
import { PromptDialog } from "@/components/ui/prompt-dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { toaster } from "@/components/ui/toaster";
import { useModule } from "@/hooks/use-modules";
import { useCreateSection } from "@/hooks/use-sections";
import { isApiError } from "@/lib/api-client";
import { routes } from "@/lib/routes";
import { MaterialEditor } from "./material-editor";
import { MaterialList } from "./material-list";
import { SectionList } from "./section-list";

/**
 * The module builder: sections, the materials inside one, and the material
 * being written.
 *
 * Three panes rather than three pages, because arranging a module is one task —
 * an Architect renaming a section and then opening a material inside it should
 * not lose their place in the tree.
 */
export function BuilderScreen({ moduleId }: { moduleId: string }) {
  const { data: module, isPending, isFetching, isError, error, refetch } = useModule(moduleId);
  const createSection = useCreateSection(moduleId);

  const [sectionId, setSectionId] = useState<string | null>(null);
  const [materialId, setMaterialId] = useState<string | null>(null);
  const [addingSection, setAddingSection] = useState(false);

  const sections = useMemo(() => module?.sections ?? [], [module]);

  /**
   * The selection is derived rather than stored-and-corrected. Both ids are
   * only a preference: a section that has been deleted simply stops matching,
   * and the first section takes over on the same render. Keeping them in state
   * would mean an effect racing the delete to fix a dangling id.
   */
  const selectedSection =
    sections.find((section) => section.id === sectionId) ?? sections[0] ?? null;

  const selectedMaterialId =
    selectedSection?.materials.find((material) => material.id === materialId)?.id ?? null;

  async function addSection(title: string) {
    setAddingSection(false);
    try {
      const created = await createSection.mutateAsync({ title });
      setSectionId(created.id);
      setMaterialId(null);
    } catch (createError) {
      toaster.error({
        title: "Could not add the section",
        description: isApiError(createError) ? createError.userMessage : undefined,
      });
    }
  }

  if (isError) {
    return (
      <PageContainer>
        <ErrorState error={error} onRetry={() => void refetch()} />
      </PageContainer>
    );
  }

  return (
    <PageContainer>
      <Button asChild variant="ghost" size="sm" alignSelf="start" mb="2">
        <NextLink href={routes.manageModules}>
          <ChevronLeft aria-hidden />
          Back to modules
        </NextLink>
      </Button>

      <PageHeader
        title={module?.title ?? "Module builder"}
        description="Arrange sections, write materials, and embed practice activities."
        action={
          <HStack gap="2">
            {module ? (
              <Badge tone={module.isPublished ? "success" : "neutral"}>
                {module.isPublished ? "Published" : "Draft"}
              </Badge>
            ) : null}
            <Button asChild variant="outline" size="sm">
              <NextLink href={routes.moduleEnrollments(moduleId)}>
                <UserCheck aria-hidden />
                Enrollments
              </NextLink>
            </Button>
          </HStack>
        }
      />

      {isPending || !module ? (
        <Skeleton height="28rem" borderRadius="lg" />
      ) : (
        <Grid templateColumns={{ base: "1fr", lg: "16rem 18rem 1fr" }} gap="5" alignItems="start">
          <Pane>
            <SectionList
              moduleId={moduleId}
              sections={sections}
              selectedId={sectionId}
              onSelect={(next) => {
                setSectionId(next);
                setMaterialId(null);
              }}
              onAdd={() => setAddingSection(true)}
              isStale={isFetching}
            />
          </Pane>

          <Pane>
            <MaterialList
              moduleId={moduleId}
              sectionId={selectedSection?.id ?? null}
              materials={selectedSection?.materials ?? []}
              selectedId={selectedMaterialId}
              onSelect={setMaterialId}
            />
          </Pane>

          <Pane>
            <MaterialEditor moduleId={moduleId} materialId={selectedMaterialId} />
          </Pane>
        </Grid>
      )}

      {addingSection ? (
        <PromptDialog
          title="New section"
          label="Title"
          placeholder="Getting started"
          confirmLabel="Add section"
          loading={createSection.isPending}
          onConfirm={(title) => void addSection(title)}
          onClose={() => setAddingSection(false)}
        />
      ) : null}
    </PageContainer>
  );
}

function Pane({ children }: { children: React.ReactNode }) {
  return (
    <Stack
      borderWidth="1px"
      borderColor="border.default"
      borderRadius="lg"
      bg="bg.surface"
      padding="4"
      gap="3"
      minWidth="0"
    >
      <Box minWidth="0">{children}</Box>
    </Stack>
  );
}
