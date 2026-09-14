"use client";

import { HStack, Stack, Text } from "@chakra-ui/react";
import { FileCode, Pencil, Trash } from "lucide-react";
import type { Language, TestScriptFramework, TestScriptValidation } from "@ambatucode/shared";
import { Badge } from "@/components/ui/badge";
import { IconButton } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { LANGUAGE_LABEL } from "@/components/editor/language-labels";
import { VALIDATION_BADGE } from "./validation";

export type ListedTestScript = {
  id: string;
  language: Language;
  framework: TestScriptFramework;
  path: string;
  /** Absent for Practice, which grades nothing. */
  weight?: number;
  validation: TestScriptValidation;
};

/** The scripts attached to an Assessment or a Practice Activity. */
export function TestScriptList<Script extends ListedTestScript>({
  scripts,
  emptyDescription,
  onEdit,
  onDelete,
}: {
  scripts: Script[];
  emptyDescription: string;
  onEdit: (script: Script) => void;
  onDelete: (script: Script) => void;
}) {
  if (scripts.length === 0) {
    return (
      <EmptyState
        icon={<FileCode aria-hidden />}
        title="No test scripts"
        description={emptyDescription}
      />
    );
  }

  return (
    <Stack gap="2">
      {scripts.map((script) => (
        <HStack
          key={script.id}
          justify="space-between"
          gap="3"
          borderWidth="1px"
          borderColor="border.default"
          borderRadius="md"
          padding="3"
        >
          <Stack gap="1" minWidth="0">
            <HStack gap="2" wrap="wrap">
              <Badge tone="accent">{script.framework}</Badge>
              <Text fontSize="sm">{LANGUAGE_LABEL[script.language]}</Text>
              <Badge tone={VALIDATION_BADGE[script.validation.status].tone}>
                {VALIDATION_BADGE[script.validation.status].label}
              </Badge>
            </HStack>
            <Text fontSize="xs" color="fg.muted" truncate>
              {script.path}
              {script.weight === undefined ? null : ` · weight ${String(script.weight)}`}
            </Text>
            {script.validation.summary === null ? null : (
              <Text
                fontSize="xs"
                color={script.validation.status === "FAILED" ? "fg.error" : "fg.muted"}
              >
                {script.validation.summary}
              </Text>
            )}
          </Stack>
          <HStack gap="1">
            <IconButton aria-label={`Edit ${script.path}`} size="sm" onClick={() => onEdit(script)}>
              <Pencil aria-hidden />
            </IconButton>
            <IconButton
              aria-label={`Remove ${script.path}`}
              size="sm"
              onClick={() => onDelete(script)}
            >
              <Trash aria-hidden />
            </IconButton>
          </HStack>
        </HStack>
      ))}
    </Stack>
  );
}
