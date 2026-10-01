"use client";

import { useMemo, useState, type MouseEvent } from "react";
import NextLink from "next/link";
import { useRouter } from "next/navigation";
import { Box, Grid, HStack, Stack } from "@chakra-ui/react";
import { ChevronLeft, Eye, EyeOff, UserCheck } from "lucide-react";
import { PageContainer, PageHeader } from "@/components/layout/app-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { ErrorState } from "@/components/ui/error-state";
import { PromptDialog } from "@/components/ui/prompt-dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { toaster } from "@/components/ui/toaster";
import { useModule, useUpdateModule } from "@/hooks/use-modules";
import { useCreateSection } from "@/hooks/use-sections";
import { isApiError } from "@/lib/api-client";
import { routes } from "@/lib/routes";
import { sectionLabel } from "@/lib/section-label";
import { AssessmentList } from "./assessment-list";
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
export function BuilderScreen({
  moduleId,
  initialSectionId = null,
}: {
  moduleId: string;
  /** From `?section=`, so a link back from an Assessment reopens its own Section. */
  initialSectionId?: string | null;
}) {
  const router = useRouter();
  const { data: module, isPending, isFetching, isError, error, refetch } = useModule(moduleId);
  const createSection = useCreateSection(moduleId);
  const updateModule = useUpdateModule();

  const [sectionId, setSectionId] = useState<string | null>(initialSectionId);
  const [materialId, setMaterialId] = useState<string | null>(null);
  const [addingSection, setAddingSection] = useState(false);
  const [confirmingUnpublish, setConfirmingUnpublish] = useState(false);
  const [materialDirty, setMaterialDirty] = useState(false);
  /** A move the Architect asked for that would throw away unsaved material edits. */
  const [pendingLeave, setPendingLeave] = useState<(() => void) | null>(null);

  const sections = useMemo(() => module?.sections ?? [], [module]);

  /**
   * The selection is derived rather than stored-and-corrected. Both ids are
   * only a preference: a section that has been deleted simply stops matching,
   * and the first section takes over on the same render. Keeping them in state
   * would mean an effect racing the delete to fix a dangling id.
   */
  const selectedSection =
    sections.find((section) => section.id === sectionId) ?? sections[0] ?? null;
  const selectedSectionNumber = selectedSection ? sections.indexOf(selectedSection) + 1 : 0;

  const selectedMaterialId =
    selectedSection?.materials.find((material) => material.id === materialId)?.id ?? null;

  /**
   * Runs `proceed` now, or once the Architect agrees to lose their unsaved
   * material edits. Every move that unmounts the material form goes through
   * here; the form cannot see those moves coming from inside the third pane.
   */
  function guard(proceed: () => void) {
    if (materialDirty) setPendingLeave(() => proceed);
    else proceed();
  }

  function selectSection(next: string) {
    if (next === selectedSection?.id) return;
    guard(() => {
      setSectionId(next);
      setMaterialId(null);
    });
  }

  function selectMaterial(next: string | null) {
    if (next === selectedMaterialId) return;
    // Null only ever follows a delete, and a deleted material has nothing left
    // to save.
    if (next === null) {
      setMaterialId(null);
      return;
    }
    guard(() => setMaterialId(next));
  }

  /** A client-side link never fires `beforeunload`, so the builder's own links ask first. */
  function guardLink(href: string) {
    return (event: MouseEvent<HTMLAnchorElement>) => {
      if (!materialDirty) return;
      // A modified click opens another tab and leaves this one, edits and all,
      // exactly where it is.
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey) return;
      event.preventDefault();
      setPendingLeave(() => () => router.push(href));
    };
  }

  /**
   * The dialog stays open until the server answers, so its loading state means
   * something and a failure leaves the typed title there to retry.
   */
  async function addSection(title: string) {
    if (createSection.isPending) return;
    try {
      const created = await createSection.mutateAsync({ title });
      setAddingSection(false);
      guard(() => {
        setSectionId(created.id);
        setMaterialId(null);
      });
    } catch (createError) {
      toaster.error({
        title: "Could not add the section",
        description: isApiError(createError) ? createError.userMessage : undefined,
      });
    }
  }

  async function setModulePublished(isPublished: boolean) {
    if (!module || updateModule.isPending) return;
    try {
      await updateModule.mutateAsync({ moduleId, changes: { isPublished } });
      toaster.success({
        title: isPublished ? `Published ${module.title}` : `Unpublished ${module.title}`,
      });
    } catch (updateError) {
      toaster.error({
        title: isPublished ? "Could not publish the module" : "Could not unpublish the module",
        description: isApiError(updateError) ? updateError.userMessage : undefined,
      });
    } finally {
      setConfirmingUnpublish(false);
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
        <NextLink href={routes.manageModules} onClick={guardLink(routes.manageModules)}>
          <ChevronLeft aria-hidden />
          Back to modules
        </NextLink>
      </Button>

      <PageHeader
        title={module?.title ?? "Module builder"}
        description={
          module && !module.isPublished
            ? "Draft — Coders cannot see this module or anything in it until it is published."
            : undefined
        }
        action={
          <HStack gap="2" wrap="wrap" justify={{ base: "flex-start", sm: "flex-end" }}>
            {module ? (
              <>
                <Badge tone={module.isPublished ? "success" : "neutral"}>
                  {module.isPublished ? "Published" : "Draft"}
                </Badge>
                {/* Publishing is the one step between a finished module and
                    its Coders, so it sits here rather than behind the Edit
                    dialog on the module list. */}
                <Button
                  size="sm"
                  variant={module.isPublished ? "outline" : "solid"}
                  loading={updateModule.isPending}
                  onClick={() => {
                    if (module.isPublished) setConfirmingUnpublish(true);
                    else void setModulePublished(true);
                  }}
                >
                  {module.isPublished ? <EyeOff aria-hidden /> : <Eye aria-hidden />}
                  {module.isPublished ? "Unpublish module" : "Publish module"}
                </Button>
              </>
            ) : null}
            <Button asChild variant="outline" size="sm">
              <NextLink
                href={routes.moduleEnrollments(moduleId)}
                onClick={guardLink(routes.moduleEnrollments(moduleId))}
              >
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
        <Grid
          // `minmax(0, …)` rather than bare widths: a grid track's default
          // minimum is its content, so the panes refused to give ground and
          // whatever was inside them — a long section title, a row of buttons —
          // pushed out past the track instead of shrinking or wrapping.
          templateColumns={{
            base: "1fr",
            lg: "minmax(0, 16rem) minmax(0, 18rem) minmax(0, 1fr)",
          }}
          gap="5"
          alignItems="start"
        >
          <Pane>
            <SectionList
              moduleId={moduleId}
              sections={sections}
              // The effective selection, not the stored preference: on first
              // load and after a delete the preference is null or dangling,
              // and the first section is the one actually on screen.
              selectedId={selectedSection?.id ?? null}
              onSelect={selectSection}
              onAdd={() => setAddingSection(true)}
              adding={createSection.isPending}
              isStale={isFetching}
            />
          </Pane>

          <Pane>
            <Stack gap="6">
              <MaterialList
                moduleId={moduleId}
                sectionId={selectedSection?.id ?? null}
                materials={selectedSection?.materials ?? []}
                selectedId={selectedMaterialId}
                onSelect={selectMaterial}
              />
              <AssessmentList
                moduleId={moduleId}
                sectionId={selectedSection?.id ?? null}
                assessments={selectedSection?.assessments ?? []}
                beforeLeave={guard}
              />
            </Stack>
          </Pane>

          <Pane>
            <MaterialEditor
              moduleId={moduleId}
              materialId={selectedMaterialId}
              modulePublished={module.isPublished}
              sectionLabel={
                selectedSection
                  ? sectionLabel({
                      sectionNumber: selectedSectionNumber,
                      sectionTitle: selectedSection.title,
                    })
                  : undefined
              }
              onDirtyChange={setMaterialDirty}
            />
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

      <ConfirmDialog
        open={confirmingUnpublish}
        title="Unpublish this module?"
        description={`Enrolled Coders lose access to "${module?.title ?? ""}" and everything in it until you publish it again. Nothing is deleted.`}
        confirmLabel="Unpublish"
        destructive
        loading={updateModule.isPending}
        onConfirm={() => void setModulePublished(false)}
        onClose={() => setConfirmingUnpublish(false)}
      />

      <ConfirmDialog
        open={pendingLeave !== null}
        title="Discard unsaved changes?"
        description="The material you are editing has changes that have not been saved. Leaving it now throws them away."
        confirmLabel="Discard changes"
        destructive
        onConfirm={() => {
          const proceed = pendingLeave;
          setPendingLeave(null);
          proceed?.();
        }}
        onClose={() => setPendingLeave(null)}
      />
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
