"use client";

import { useCallback, useMemo, useState } from "react";
import NextLink from "next/link";
import { Box, Flex, HStack, Stack, Text } from "@chakra-ui/react";
import { ChevronLeft, Save } from "lucide-react";
import { timingProblem, type AssessmentArchitectView } from "@ambatucode/shared";
import { PageContainer, PageHeader } from "@/components/layout/app-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/ui/error-state";
import { Skeleton } from "@/components/ui/skeleton";
import { TabBar } from "@/components/ui/tabs";
import { toaster } from "@/components/ui/toaster";
import { useAssessment, useUpdateAssessment } from "@/hooks/use-assessments";
import { isApiError } from "@/lib/api-client";
import { routes } from "@/lib/routes";
import { AntiCheatTab, LimitsTab, TimingTab } from "./configuration-tabs";
import { ProblemTab, StarterCodeTab } from "./problem-tabs";
import { SessionsPanel } from "./sessions-panel";
import { TestCasesTab } from "./test-cases-tab";
import { TestScriptsTab } from "./test-scripts-tab";
import { diffAssessment, draftFrom, type AssessmentDraft } from "./draft";

/**
 * The Assessment editor.
 *
 * The definition is edited as one local draft and saved in one PATCH, because
 * its parts constrain each other: an untimed Assessment has no duration and no
 * execution mode, and a field-by-field autosave would have to send invalid
 * intermediate states to the server and explain the rejections.
 *
 * Test cases and test scripts are separate resources with their own endpoints,
 * so they save on their own and are not part of that draft.
 */

const TABS = [
  { value: "problem", label: "Problem" },
  { value: "starter", label: "Starter code" },
  { value: "cases", label: "Test cases" },
  { value: "scripts", label: "Test scripts" },
  { value: "limits", label: "Limits" },
  { value: "timing", label: "Timing" },
  { value: "anticheat", label: "Anti-cheat" },
] as const;

export function AssessmentEditor({ assessmentId }: { assessmentId: string }) {
  const { data, isPending, isError, error, refetch } = useAssessment(assessmentId);
  /** Lifted so remounting the form on a save does not also reset the tab. */
  const [tab, setTab] = useState<string>("problem");

  if (isError) {
    return (
      <PageContainer>
        <ErrorState error={error} onRetry={() => void refetch()} />
      </PageContainer>
    );
  }

  if (isPending) {
    return (
      <PageContainer>
        <Skeleton height="32rem" borderRadius="lg" />
      </PageContainer>
    );
  }

  if (data.view !== "ARCHITECT") {
    return (
      <PageContainer>
        <ErrorState error={new Error("forbidden")} title="This assessment is not yours to edit" />
      </PageContainer>
    );
  }

  /*
   * Keyed by the saved timestamp so a successful save — or a refetch carrying
   * someone else's change — reseeds the form from what the server now holds,
   * rather than leaving a draft built on data that no longer exists.
   */
  return (
    <EditorBody
      key={data.assessment.updatedAt}
      assessment={data.assessment}
      tab={tab}
      onTabChange={setTab}
    />
  );
}

function EditorBody({
  assessment,
  tab,
  onTabChange,
}: {
  assessment: AssessmentArchitectView;
  tab: string;
  onTabChange: (tab: string) => void;
}) {
  const [draft, setDraft] = useState<AssessmentDraft>(() => draftFrom(assessment));

  const update = useUpdateAssessment(assessment.id, assessment.moduleId);
  const patch = useMemo(() => diffAssessment(assessment, draft), [assessment, draft]);
  const dirty = Object.keys(patch).length > 0;

  const change = useCallback((changes: Partial<AssessmentDraft>) => {
    setDraft((current) => ({ ...current, ...changes }));
  }, []);

  const save = useCallback(async () => {
    const problem = timingProblem({
      timeMode: draft.timeMode,
      durationMinutes: draft.durationMinutes,
      executionMode: draft.executionMode,
    });
    if (problem) {
      onTabChange("timing");
      toaster.error({ title: "Timing needs attention", description: problem });
      return;
    }

    try {
      await update.mutateAsync(patch);
      toaster.success({ title: "Assessment saved" });
    } catch (saveError) {
      toaster.error({
        title: "Could not save the assessment",
        description: isApiError(saveError) ? saveError.userMessage : undefined,
      });
    }
  }, [draft, onTabChange, patch, update]);

  return (
    <PageContainer>
      <Button asChild variant="ghost" size="sm" alignSelf="start" mb="2">
        <NextLink href={routes.moduleBuilder(assessment.moduleId)}>
          <ChevronLeft aria-hidden />
          Back to the module builder
        </NextLink>
      </Button>

      <PageHeader
        title={assessment.title}
        description="Problem, cases, limits, timing, and anti-cheat for this assessment."
        action={
          <HStack gap="2">
            <Badge tone={draft.isPublished ? "success" : "neutral"}>
              {draft.isPublished ? "Published" : "Draft"}
            </Badge>
            <Button
              variant="outline"
              size="sm"
              onClick={() => change({ isPublished: !draft.isPublished })}
            >
              {draft.isPublished ? "Unpublish" : "Publish"}
            </Button>
            <Button size="sm" onClick={() => void save()} disabled={!dirty} loading={update.isPending}>
              <Save aria-hidden />
              Save changes
            </Button>
          </HStack>
        }
      />

      <Stack gap="5">
        <TabBar aria-label="Assessment editor" items={TABS} value={tab} onValueChange={onTabChange} />

        <Box
          borderWidth="1px"
          borderColor="border.default"
          borderRadius="lg"
          bg="bg.surface"
          padding="5"
        >
          {tab === "problem" ? <ProblemTab draft={draft} onChange={change} /> : null}
          {tab === "starter" ? <StarterCodeTab draft={draft} onChange={change} /> : null}
          {tab === "cases" ? <TestCasesTab assessment={assessment} /> : null}
          {tab === "scripts" ? <TestScriptsTab assessment={assessment} /> : null}
          {tab === "limits" ? <LimitsTab draft={draft} onChange={change} /> : null}
          {tab === "timing" ? <TimingTab draft={draft} onChange={change} /> : null}
          {tab === "anticheat" ? <AntiCheatTab draft={draft} onChange={change} /> : null}
        </Box>

        {dirty ? (
          <Flex justify="flex-end">
            <Text fontSize="xs" color="fg.muted" aria-live="polite">
              Unsaved changes
            </Text>
          </Flex>
        ) : null}

        <SessionsPanel assessment={assessment} />
      </Stack>
    </PageContainer>
  );
}
