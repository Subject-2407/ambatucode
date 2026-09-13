"use client";

import NextLink from "next/link";
import { Stack, Text } from "@chakra-ui/react";
import type { AttemptWarningPayload } from "@ambatucode/shared";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";

/**
 * The three ways the workspace stops being a place to work, and how each is
 * explained.
 *
 * All three are blocking. Each describes something the Coder did not choose
 * and cannot undo, and a dialog they can dismiss by clicking the backdrop is a
 * dialog they will dismiss without reading.
 */

/**
 * The deadline passed and the server submitted the draft it already held.
 *
 * The wording matters: nothing was lost, and the Coder needs to know that
 * before they know anything else. What was submitted is the latest code the
 * server had received, which is what the SRS promises and what the autosave
 * layers exist to keep current.
 */
export function AutoSubmittedModal({
  open,
  submissionId,
  onView,
}: {
  open: boolean;
  submissionId: string | null;
  onView: () => void;
}) {
  return (
    <Modal
      open={open}
      onOpenChange={() => undefined}
      blocking
      title="Time is up — your work was submitted"
      footer={
        <Button onClick={onView} autoFocus>
          See the result
        </Button>
      }
    >
      <Stack gap="3">
        <Text>
          The assessment reached its deadline, so the server submitted the most recent code it had
          saved for you. You do not need to do anything else.
        </Text>
        {submissionId === null ? null : (
          <Text fontSize="sm" color="fg.muted">
            Grading runs in the background; the result appears as soon as it finishes.
          </Text>
        )}
      </Stack>
    </Modal>
  );
}

/**
 * Another browser or device joined this attempt, so this one is no longer the
 * active connection. There is deliberately no "take it back" button: two
 * browsers fighting over one attempt is worse than either of them losing, and
 * the Coder is standing at the one they meant to use.
 */
export function SupersededModal({ open, moduleHref }: { open: boolean; moduleHref: string }) {
  return (
    <Modal
      open={open}
      onOpenChange={() => undefined}
      blocking
      title="This attempt was opened somewhere else"
      footer={
        <Button asChild autoFocus>
          <NextLink href={moduleHref}>Back to the module</NextLink>
        </Button>
      }
    >
      <Stack gap="3">
        <Text>
          The same account joined this assessment from another browser or device, and only one
          connection may take part at a time. Continue there — your saved code went with it.
        </Text>
        <Text fontSize="sm" color="fg.muted">
          This window has stopped counting time and no longer accepts changes.
        </Text>
      </Stack>
    </Modal>
  );
}

/**
 * The Architect configured a warning for focus loss and the threshold has been
 * passed. Dismissable, because it is a warning and not an ending — but it says
 * plainly that the event was recorded rather than hinting at consequences.
 */
export function FocusWarningModal({
  warning,
  onDismiss,
}: {
  warning: AttemptWarningPayload | null;
  onDismiss: () => void;
}) {
  return (
    <Modal
      open={warning !== null}
      onOpenChange={(next) => {
        if (!next) onDismiss();
      }}
      size="sm"
      title="You left the assessment window"
      footer={
        <Button onClick={onDismiss} autoFocus>
          Back to work
        </Button>
      }
    >
      <Stack gap="3">
        <Text>{warning?.message}</Text>
        <Text fontSize="sm" color="fg.muted">
          Switching tabs or applications during this assessment is recorded and visible to your
          Architect. Your time is still running.
        </Text>
      </Stack>
    </Modal>
  );
}
