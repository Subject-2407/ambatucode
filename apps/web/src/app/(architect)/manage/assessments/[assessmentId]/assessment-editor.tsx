"use client";

import { useCallback, useId, useMemo, useState } from "react";
import NextLink from "next/link";
import { Alert, Box, Flex, HStack, Stack, Text } from "@chakra-ui/react";
import { ChevronLeft, Save } from "lucide-react";
import { timingProblem, type AssessmentArchitectView } from "@ambatucode/shared";
import { ProblemPanel } from "@/components/assessment/problem-panel";
import { PageContainer, PageHeader } from "@/components/layout/app-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/ui/error-state";
import { PixelFrame } from "@/components/ui/pixel-frame";
import { Skeleton } from "@/components/ui/skeleton";
import { TabBar, TabPanel } from "@/components/ui/tabs";
import { toaster } from "@/components/ui/toaster";
import { useAssessment, useUpdateAssessment } from "@/hooks/use-assessments";
import { useUnsavedChangesWarning } from "@/hooks/use-unsaved-changes-warning";
import { isApiError } from "@/lib/api-client";
import { routes } from "@/lib/routes";
import { AntiCheatTab, LimitsTab, TimingTab } from "./configuration-tabs";
import { ProblemTab, StarterCodeTab } from "./problem-tabs";
import { SessionsPanel } from "./sessions-panel";
import { TestCasesTab } from "./test-cases-tab";
import { TestScriptsTab } from "./test-scripts-tab";
import {
  DRAFT_FIELD_LABEL,
  diffAssessment,
  draftFrom,
  rebaseDraft,
  sampleCasesFrom,
  takeSaved,
  type AssessmentDraft,
  type DraftField,
} from "./draft";

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
  { value: "preview", label: "Preview" },
] as const;

export function AssessmentEditor({ assessmentId }: { assessmentId: string }) {
  const { data, isPending, isError, error, refetch } = useAssessment(assessmentId);
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
   * Keyed by the Assessment, not by its saved timestamp. Nearly every write
   * here — a reference solution, a test case, a finished validation — moves
   * `updatedAt`, and keying on it remounted the form and threw away whatever
   * the Architect had not saved. New reads are folded into the draft instead;
   * see `rebaseDraft`.
   */
  return (
    <EditorBody
      key={data.assessment.id}
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
  /** The read the draft was last reconciled with. */
  const [base, setBase] = useState(assessment);
  const [draft, setDraft] = useState<AssessmentDraft>(() => draftFrom(assessment));
  /** Fields where saving would overwrite a change made somewhere else. */
  const [overridden, setOverridden] = useState<ReadonlySet<DraftField>>(() => new Set());
  const panelId = useId();

  /*
   * A new read of the Assessment is merged into the draft during render, as
   * the section tree does with its order. An effect would paint one frame of
   * a draft measured against the wrong read — and in that frame, Save would
   * send it.
   */
  if (base !== assessment) {
    const rebased = rebaseDraft(base, draft, assessment);
    setBase(assessment);
    setDraft(rebased.draft);
    if (rebased.conflicts.length > 0) {
      setOverridden((current) => new Set([...current, ...rebased.conflicts]));
    }
  }

  const update = useUpdateAssessment(assessment.id, assessment.moduleId);
  const patch = useMemo(() => diffAssessment(assessment, draft), [assessment, draft]);
  const dirty = Object.keys(patch).length > 0;
  // A conflict lasts only while the draft still disagrees with the saved value.
  const conflicts = [...overridden].filter((field) => field in patch);

  useUnsavedChangesWarning(dirty);

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
      setOverridden(new Set());
      toaster.success({ title: "Assessment saved" });
    } catch (saveError) {
      toaster.error({
        title: "Could not save the assessment",
        description: isApiError(saveError) ? saveError.userMessage : undefined,
      });
    }
  }, [draft, onTabChange, patch, update]);

  const publishPending = draft.isPublished !== assessment.isPublished;

  return (
    <PageContainer>
      <Button asChild variant="ghost" size="sm" alignSelf="start" mb="2">
        {/* Back to this Assessment's own Section, not the top of the tree. */}
        <NextLink
          href={`${routes.moduleBuilder(assessment.moduleId)}?section=${encodeURIComponent(assessment.sectionId)}`}
        >
          <ChevronLeft aria-hidden />
          Back to the module builder
        </NextLink>
      </Button>

      <PageHeader
        title={assessment.title}
        description="Problem, cases, limits, timing, and anti-cheat for this assessment."
        action={
          <HStack gap="2" wrap="wrap" justify={{ base: "flex-start", sm: "flex-end" }}>
            {/* The badge reports what Coders get now, which is the saved
                value. The draft's intent is spelled out beside it until saved. */}
            <Badge tone={assessment.isPublished ? "success" : "neutral"}>
              {assessment.isPublished ? "Published" : "Draft"}
            </Badge>
            {publishPending ? (
              <Text fontSize="xs" color="fg.warning">
                {draft.isPublished ? "Publishes when saved" : "Unpublishes when saved"}
              </Text>
            ) : null}
            <Button
              variant="outline"
              size="sm"
              onClick={() => change({ isPublished: !draft.isPublished })}
            >
              {draft.isPublished ? "Unpublish" : "Publish"}
            </Button>
            <Button
              size="sm"
              onClick={() => void save()}
              disabled={!dirty}
              loading={update.isPending}
            >
              <Save aria-hidden />
              Save changes
            </Button>
          </HStack>
        }
      />

      <Stack gap="5">
        {conflicts.length > 0 ? (
          <Alert.Root status="warning" size="sm">
            <Alert.Indicator />
            <Alert.Content>
              <Alert.Title>Changed elsewhere while you were editing</Alert.Title>
              <Alert.Description>
                {conflicts.map((field) => DRAFT_FIELD_LABEL[field]).join(", ")}. Saving replaces
                that change with yours.
              </Alert.Description>
            </Alert.Content>
            <Button
              size="xs"
              variant="outline"
              alignSelf="center"
              onClick={() => {
                setDraft((current) => takeSaved(current, assessment, conflicts));
                setOverridden(new Set());
              }}
            >
              Use the saved version
            </Button>
          </Alert.Root>
        ) : null}

        <TabBar
          aria-label="Assessment editor"
          items={TABS}
          value={tab}
          onValueChange={onTabChange}
          controls={panelId}
        />

        <TabPanel
          id={panelId}
          value={tab}
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
          {tab === "preview" ? <ProblemPreview assessment={assessment} draft={draft} /> : null}
        </TabPanel>

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

/**
 * The problem as a Coder's workspace shows it, from the unsaved draft.
 *
 * Only the public cases are passed in, through the same filter the server's
 * workspace serializer applies. `ProblemPanel` is built for the Coder's view
 * and must never be handed a hidden case, even on a screen only the owning
 * Architect can open.
 */
function ProblemPreview({
  assessment,
  draft,
}: {
  assessment: AssessmentArchitectView;
  draft: AssessmentDraft;
}) {
  const sampleCases = sampleCasesFrom(assessment.testCases);
  const hiddenCount = assessment.testCases.length - sampleCases.length;

  return (
    <Stack gap="4">
      <Text fontSize="sm" color="fg.muted">
        The problem panel of the workspace, from your unsaved edits.{" "}
        {hiddenCount > 0
          ? `${String(hiddenCount)} hidden ${hiddenCount === 1 ? "case is" : "cases are"} not shown, as they never are to a Coder.`
          : null}
        {sampleCases.length === 0 ? " There are no public cases, so Coders get no samples." : null}
      </Text>
      <Box maxWidth="48rem">
        <PixelFrame>
          <ProblemPanel
            title={draft.title.trim() === "" ? "Untitled assessment" : draft.title}
            problemStatement={draft.problemStatement}
            sampleCases={sampleCases}
          />
        </PixelFrame>
      </Box>
    </Stack>
  );
}
