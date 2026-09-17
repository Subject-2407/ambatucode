"use client";

import { useState } from "react";
import { Field, Stack, Text, Textarea } from "@chakra-ui/react";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";

const MIN_REASON = 3;
const MAX_REASON = 500;

/**
 * Resetting a Coder's attempt.
 *
 * The dialog says the two things an Architect needs to be sure of before
 * pressing the button: nothing is deleted, and the official score becomes
 * theirs to choose again. Both are true of the server behaviour, and saying so
 * here is what stops "reset" reading like "erase".
 *
 * The reason is required rather than optional. It goes into the event log
 * beside the Architect's name, so a record that was reset always has an answer
 * to why — and typing one is a moment's pause before an action that gives a
 * Coder a second attempt.
 */
export function ResetAttemptDialog({
  open,
  coderName,
  assessmentTitle,
  attemptNumber,
  loading,
  onConfirm,
  onClose,
}: {
  open: boolean;
  coderName: string;
  assessmentTitle: string;
  attemptNumber: number;
  loading: boolean;
  onConfirm: (reason: string) => void;
  onClose: () => void;
}) {
  // Starts empty every time, because the caller keys this component on the
  // attempt being reset — a reason typed for one Coder is never waiting in the
  // box for the next.
  const [reason, setReason] = useState("");

  const trimmed = reason.trim();
  const tooShort = trimmed.length < MIN_REASON;

  return (
    <Modal
      open={open}
      onOpenChange={(next) => {
        if (!next && !loading) onClose();
      }}
      size="md"
      title={`Reset attempt ${attemptNumber} for ${coderName}?`}
      description={
        <Stack gap="2">
          <Text>
            This opens a new attempt at <strong>{assessmentTitle}</strong>. Every submission
            already made stays in the history exactly as it is — nothing is deleted.
          </Text>
          <Text>
            The official score is cleared while you decide. It settles on the new attempt once it
            is submitted, and you can point it back at an earlier attempt at any time.
          </Text>
        </Stack>
      }
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={loading}>
            Cancel
          </Button>
          <Button
            colorPalette="danger"
            loading={loading}
            disabled={tooShort}
            onClick={() => onConfirm(trimmed)}
          >
            Reset attempt
          </Button>
        </>
      }
    >
      <Field.Root required>
        <Field.Label>
          Reason
          <Field.RequiredIndicator />
        </Field.Label>
        <Textarea
          value={reason}
          maxLength={MAX_REASON}
          rows={3}
          placeholder="Power cut in lab 3"
          onChange={(event) => setReason(event.currentTarget.value)}
        />
        <Field.HelperText>
          <Text as="span" fontSize="xs">
            Recorded in the session log with your name. {trimmed.length}/{MAX_REASON}
          </Text>
        </Field.HelperText>
      </Field.Root>
    </Modal>
  );
}
