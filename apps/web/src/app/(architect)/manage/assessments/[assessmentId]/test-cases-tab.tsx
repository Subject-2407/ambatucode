"use client";

import { useState } from "react";
import { Box, HStack, Stack, Table, Text, Textarea } from "@chakra-ui/react";
import { Eye, EyeOff, Plus, Trash } from "lucide-react";
import {
  createTestCaseRequestSchema,
  type AssessmentArchitectView,
  type ComparisonMode,
  type TestCaseKind,
  type TestCaseView,
} from "@ambatucode/shared";
import { Badge } from "@/components/ui/badge";
import { Button, IconButton } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { DataTable } from "@/components/ui/table";
import { EmptyState } from "@/components/ui/empty-state";
import { TextField } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { SelectField } from "@/components/ui/select";
import { toaster } from "@/components/ui/toaster";
import {
  useCreateTestCase,
  useDeleteTestCase,
  useUpdateTestCase,
} from "@/hooks/use-assessments";
import { isApiError } from "@/lib/api-client";

/**
 * The Assessment's test cases.
 *
 * Public and Hidden are the most consequential distinction on this screen —
 * a case marked Public is shown to every Coder, input and expected output
 * both — so it is never a subtle checkbox. It is a labelled badge with an icon
 * in the table and a named choice in the editor, and new cases default to
 * Hidden so that exposing one is always a deliberate act.
 */
export function TestCasesTab({ assessment }: { assessment: AssessmentArchitectView }) {
  const [editing, setEditing] = useState<TestCaseView | "new" | null>(null);
  const [deleting, setDeleting] = useState<TestCaseView | null>(null);
  const remove = useDeleteTestCase(assessment.id);

  async function confirmDelete() {
    if (!deleting) return;
    try {
      await remove.mutateAsync(deleting.id);
      toaster.success({ title: "Test case removed" });
    } catch (error) {
      toaster.error({
        title: "Could not remove the test case",
        description: isApiError(error) ? error.userMessage : undefined,
      });
    } finally {
      setDeleting(null);
    }
  }

  return (
    <Stack gap="4">
      <HStack justify="space-between" gap="3" wrap="wrap">
        <Text fontSize="sm" color="fg.muted">
          Public cases are shown to Coders as samples and are what Run checks against. Hidden cases
          are used for grading only and never reach a browser.
        </Text>
        <Button size="sm" onClick={() => setEditing("new")}>
          <Plus aria-hidden />
          Add case
        </Button>
      </HStack>

      {assessment.testCases.length === 0 ? (
        <EmptyState
          title="No test cases yet"
          description="A session cannot start until the assessment has at least one test case or test script."
        />
      ) : (
        <DataTable caption="Test cases for this assessment">
          <Table.Header>
            <Table.Row>
              <Table.ColumnHeader>Name</Table.ColumnHeader>
              <Table.ColumnHeader>Visibility</Table.ColumnHeader>
              <Table.ColumnHeader>Comparison</Table.ColumnHeader>
              <Table.ColumnHeader textAlign="end">Weight</Table.ColumnHeader>
              <Table.ColumnHeader />
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {assessment.testCases.map((testCase) => (
              <Table.Row key={testCase.id}>
                <Table.Cell>
                  <Box
                    asChild
                    textAlign="start"
                    _hover={{ textDecoration: "underline" }}
                  >
                    <button type="button" onClick={() => setEditing(testCase)}>
                      {testCase.name}
                    </button>
                  </Box>
                </Table.Cell>
                <Table.Cell>
                  <VisibilityBadge kind={testCase.kind} />
                </Table.Cell>
                <Table.Cell>
                  <Text fontSize="sm" color="fg.muted">
                    {COMPARISON_LABEL[testCase.comparison]}
                  </Text>
                </Table.Cell>
                <Table.Cell textAlign="end">{testCase.weight}</Table.Cell>
                <Table.Cell textAlign="end">
                  <IconButton
                    aria-label={`Remove ${testCase.name}`}
                    size="sm"
                    onClick={() => setDeleting(testCase)}
                  >
                    <Trash aria-hidden />
                  </IconButton>
                </Table.Cell>
              </Table.Row>
            ))}
          </Table.Body>
        </DataTable>
      )}

      {editing === null ? null : (
        <TestCaseDialog
          assessmentId={assessment.id}
          testCase={editing === "new" ? undefined : editing}
          onClose={() => setEditing(null)}
        />
      )}

      <ConfirmDialog
        open={deleting !== null}
        title="Remove this test case?"
        description={`"${deleting?.name ?? ""}" will no longer be used for grading. Submissions already graded keep their scores.`}
        confirmLabel="Remove"
        destructive
        loading={remove.isPending}
        onConfirm={() => void confirmDelete()}
        onClose={() => setDeleting(null)}
      />
    </Stack>
  );
}

const COMPARISON_LABEL: Readonly<Record<ComparisonMode, string>> = {
  EXACT: "Exact",
  TRIMMED: "Ignore surrounding whitespace",
  TOKEN: "Compare tokens",
  NUMERIC_TOLERANT: "Numeric, with tolerance",
};

/** Never colour alone: the icon and the word carry it too. */
function VisibilityBadge({ kind }: { kind: TestCaseKind }) {
  return kind === "PUBLIC" ? (
    <Badge tone="warning">
      <Eye size={12} aria-hidden /> Public
    </Badge>
  ) : (
    <Badge tone="neutral">
      <EyeOff size={12} aria-hidden /> Hidden
    </Badge>
  );
}

function TestCaseDialog({
  assessmentId,
  testCase,
  onClose,
}: {
  assessmentId: string;
  testCase?: TestCaseView;
  onClose: () => void;
}) {
  const editing = testCase !== undefined;
  const create = useCreateTestCase(assessmentId);
  const update = useUpdateTestCase(assessmentId);

  const [name, setName] = useState(testCase?.name ?? "");
  const [kind, setKind] = useState<TestCaseKind>(testCase?.kind ?? "HIDDEN");
  const [input, setInput] = useState(testCase?.input ?? "");
  const [expectedOutput, setExpectedOutput] = useState(testCase?.expectedOutput ?? "");
  const [comparison, setComparison] = useState<ComparisonMode>(testCase?.comparison ?? "TRIMMED");
  const [weight, setWeight] = useState(String(testCase?.weight ?? 1));
  const [error, setError] = useState<string | null>(null);

  const pending = create.isPending || update.isPending;

  async function save() {
    setError(null);
    const parsed = createTestCaseRequestSchema.safeParse({
      name,
      kind,
      input,
      expectedOutput,
      comparison,
      weight: Number.parseInt(weight, 10),
      timeLimitMs: testCase?.timeLimitMs ?? null,
      memoryLimitMb: testCase?.memoryLimitMb ?? null,
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Check the fields above.");
      return;
    }

    try {
      if (editing) await update.mutateAsync({ testCaseId: testCase.id, changes: parsed.data });
      else await create.mutateAsync(parsed.data);
      toaster.success({ title: editing ? "Test case saved" : "Test case added" });
      onClose();
    } catch (saveError) {
      setError(
        isApiError(saveError) ? saveError.userMessage : "Could not save the test case.",
      );
    }
  }

  return (
    <Modal
      open
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      size="lg"
      title={editing ? "Edit test case" : "New test case"}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button onClick={() => void save()} loading={pending}>
            Save case
          </Button>
        </>
      }
    >
      <Stack gap="4">
        <TextField
          label="Name"
          value={name}
          onChange={(event) => setName(event.currentTarget.value)}
          placeholder="Handles an empty list"
          autoFocus
        />

        <SelectField
          label="Visibility"
          value={kind}
          onChange={(value) => setKind(value as TestCaseKind)}
          options={[
            { value: "HIDDEN", label: "Hidden — used for grading only" },
            { value: "PUBLIC", label: "Public — shown to Coders as a sample" },
          ]}
          helperText={
            kind === "PUBLIC"
              ? "Every Coder will see this input and this expected output."
              : "This case never reaches a browser, not even in an error message."
          }
        />

        <Stack gap="1">
          <Text fontSize="sm" fontWeight="medium">
            Input
          </Text>
          <Textarea
            value={input}
            onChange={(event) => setInput(event.currentTarget.value)}
            rows={5}
            fontFamily="mono"
            fontSize="sm"
          />
        </Stack>

        <Stack gap="1">
          <Text fontSize="sm" fontWeight="medium">
            Expected output
          </Text>
          <Textarea
            value={expectedOutput}
            onChange={(event) => setExpectedOutput(event.currentTarget.value)}
            rows={5}
            fontFamily="mono"
            fontSize="sm"
          />
        </Stack>

        <HStack gap="4" align="start">
          <SelectField
            label="Comparison"
            value={comparison}
            onChange={(value) => setComparison(value as ComparisonMode)}
            options={Object.entries(COMPARISON_LABEL).map(([value, label]) => ({ value, label }))}
          />
          <TextField
            label="Weight"
            type="number"
            min={0}
            max={1_000}
            value={weight}
            onChange={(event) => setWeight(event.currentTarget.value)}
            helperText="Relative to the other cases."
          />
        </HStack>

        {error === null ? null : (
          <Text fontSize="sm" color="fg.error" aria-live="polite">
            {error}
          </Text>
        )}
      </Stack>
    </Modal>
  );
}
