"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Box, Flex, HStack, Stack, Text } from "@chakra-ui/react";
import { ClipboardCheck, Plus, Trash } from "lucide-react";
import type { AssessmentSummary } from "@ambatucode/shared";
import { Badge } from "@/components/ui/badge";
import { Button, IconButton } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { PromptDialog } from "@/components/ui/prompt-dialog";
import { toaster } from "@/components/ui/toaster";
import { useCreateAssessment, useDeleteAssessment } from "@/hooks/use-assessments";
import { isApiError } from "@/lib/api-client";
import { routes } from "@/lib/routes";
import { pixelSkin } from "@/theme/pixel";

/**
 * The assessments of the selected section.
 *
 * Unlike a Material, an Assessment opens on its own page rather than in the
 * third pane: it carries test cases, scripts, limits, timing, anti-cheat, and
 * its sessions, which is more than a pane beside a section tree can hold
 * without becoming a worse version of both.
 */
export function AssessmentList({
  moduleId,
  sectionId,
  assessments,
}: {
  moduleId: string;
  sectionId: string | null;
  assessments: AssessmentSummary[];
}) {
  const router = useRouter();
  const createAssessment = useCreateAssessment(moduleId, sectionId ?? "");
  const deleteAssessment = useDeleteAssessment(moduleId);
  const [adding, setAdding] = useState(false);
  const [deleting, setDeleting] = useState<AssessmentSummary | null>(null);

  async function add(title: string) {
    setAdding(false);
    if (sectionId === null) return;

    try {
      // Created untimed and unpublished with a placeholder statement: the
      // editor is where an Assessment is actually written, and asking for
      // seven settings before it exists would make adding one a chore.
      const created = await createAssessment.mutateAsync({
        title,
        problemStatement: "Describe the problem here.",
        allowedLanguages: ["python"],
        starterCode: {},
        timeMode: "UNTIMED",
        durationMinutes: null,
        executionMode: null,
        timeLimitMs: 5_000,
        memoryLimitMb: 256,
        gradingStrategy: "WEIGHTED_AVERAGE",
        exitPolicy: "RESUME",
        isOpenAccess: false,
        antiCheat: {
          blockClipboard: false,
          blockContextMenu: false,
          detectFocusLoss: false,
          focusLossAction: "LOG_ONLY",
          focusLossThreshold: 0,
          hideLeaderboard: false,
        },
        isPublished: false,
      });
      router.push(routes.manageAssessment(created.id));
    } catch (error) {
      toaster.error({
        title: "Could not add the assessment",
        description: isApiError(error) ? error.userMessage : undefined,
      });
    }
  }

  async function remove(assessment: AssessmentSummary) {
    setDeleting(null);
    try {
      await deleteAssessment.mutateAsync(assessment.id);
      toaster.success({ title: `Deleted ${assessment.title}` });
    } catch (error) {
      toaster.error({
        title: "Could not delete the assessment",
        description: isApiError(error) ? error.userMessage : undefined,
      });
    }
  }

  if (sectionId === null) return null;

  return (
    <Stack gap="3">
      <Flex justify="space-between" align="center">
        <Text textStyle="display" fontSize="sm">
          Assessments
        </Text>
        <Button
          size="xs"
          variant="ghost"
          onClick={() => setAdding(true)}
          loading={createAssessment.isPending}
        >
          <Plus aria-hidden />
          Add assessment
        </Button>
      </Flex>

      {assessments.length === 0 ? (
        <Text fontSize="sm" color="fg.muted">
          This section has no assessments yet.
        </Text>
      ) : (
        <Stack gap="2">
          {assessments.map((assessment) => (
            <Flex
              key={assessment.id}
              align="center"
              gap="1"
              {...pixelSkin(
                "var(--amb-colors-border-default)",
                "var(--amb-colors-bg-surface)",
                2,
              )}
              padding="2"
            >
              <Box asChild flex="1" minWidth="0" textAlign="start">
                <button
                  type="button"
                  onClick={() => router.push(routes.manageAssessment(assessment.id))}
                >
                  <HStack gap="2" minWidth="0">
                    <ClipboardCheck size={14} aria-hidden />
                    <Text fontSize="sm" truncate>
                      {assessment.title}
                    </Text>
                  </HStack>
                  <HStack gap="2" mt="1">
                    <Badge tone={assessment.isPublished ? "success" : "neutral"}>
                      {assessment.isPublished ? "Published" : "Draft"}
                    </Badge>
                    <Badge tone={assessment.timeMode === "TIMED" ? "warning" : "neutral"}>
                      {assessment.timeMode === "TIMED"
                        ? `${String(assessment.durationMinutes ?? 0)} min`
                        : "Untimed"}
                    </Badge>
                  </HStack>
                </button>
              </Box>

              <IconButton
                aria-label={`Delete ${assessment.title}`}
                size="xs"
                onClick={() => setDeleting(assessment)}
              >
                <Trash size={14} aria-hidden />
              </IconButton>
            </Flex>
          ))}
        </Stack>
      )}

      {adding ? (
        <PromptDialog
          title="New assessment"
          label="Title"
          placeholder="Implement binary search"
          confirmLabel="Add assessment"
          loading={createAssessment.isPending}
          onConfirm={(title) => void add(title)}
          onClose={() => setAdding(false)}
        />
      ) : null}

      <ConfirmDialog
        open={deleting !== null}
        title="Delete assessment"
        description={`"${deleting?.title ?? ""}" and its sessions will be removed. Assessments with submissions cannot be deleted.`}
        confirmLabel="Delete"
        destructive
        loading={deleteAssessment.isPending}
        onConfirm={() => {
          if (deleting) void remove(deleting);
        }}
        onClose={() => setDeleting(null)}
      />
    </Stack>
  );
}
