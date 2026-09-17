"use client";

import { Stack, Text } from "@chakra-ui/react";
import { LANGUAGE_LABEL } from "@/components/editor/language-labels";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import type { Language } from "@ambatucode/shared";

/**
 * The confirmation before the one formal Submit.
 *
 * It states the consequence in plain words rather than relying on the Coder
 * having read the assessment rules: this is the only submission for the
 * attempt, and there is no undo. The SRS allows exactly one, and a dialog that
 * merely said "Are you sure?" would be the platform declining to explain the
 * single most consequential click in the product.
 */
export function SubmitDialog({
  open,
  language,
  lineCount,
  submitting,
  onConfirm,
  onClose,
}: {
  open: boolean;
  language: Language;
  lineCount: number;
  submitting: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <Modal
      open={open}
      onOpenChange={(next) => {
        if (!next && !submitting) onClose();
      }}
      size="sm"
      title="Submit this attempt?"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={submitting}>
            Keep working
          </Button>
          <Button onClick={onConfirm} loading={submitting} loadingText="Submitting" autoFocus>
            Submit
          </Button>
        </>
      }
    >
      <Stack gap="3">
        <Text>
          This is the only submission you get for this attempt. Once it is sent, the editor closes
          and you cannot submit again.
        </Text>
        <Text fontSize="sm" color="fg.muted">
          {LANGUAGE_LABEL[language]} · {lineCount} {lineCount === 1 ? "line" : "lines"} · exactly
          what is in your editor right now.
        </Text>
      </Stack>
    </Modal>
  );
}
