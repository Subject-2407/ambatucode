"use client";

import {
  Spinner,
  Stack,
  Toast,
  Toaster as ChakraToaster,
  createToaster,
  Portal,
} from "@chakra-ui/react";

/**
 * A single toast store for the whole app.
 *
 * Toasts are for things that happened, not for things a user must act on — the
 * SRS reserves modals for that. Keep the queue short: three at once is already
 * more than anyone reads during an assessment.
 */
export const toaster = createToaster({
  placement: "bottom-end",
  pauseOnPageIdle: true,
  max: 3,
  overlap: true,
});

export function Toaster() {
  return (
    <Portal>
      <ChakraToaster toaster={toaster} insetInline={{ mdDown: "4" }}>
        {(toast) => (
          <Toast.Root width={{ md: "sm" }} bg="bg.surface" boxShadow="overlay">
            {toast.type === "loading" ? (
              <Spinner size="sm" color="accent.solid" />
            ) : (
              <Toast.Indicator />
            )}
            <Stack gap="1" flex="1" maxWidth="100%">
              {toast.title ? <Toast.Title>{toast.title}</Toast.Title> : null}
              {toast.description ? (
                <Toast.Description>{toast.description}</Toast.Description>
              ) : null}
            </Stack>
            {toast.action ? <Toast.ActionTrigger>{toast.action.label}</Toast.ActionTrigger> : null}
            {toast.closable ? <Toast.CloseTrigger /> : null}
          </Toast.Root>
        )}
      </ChakraToaster>
    </Portal>
  );
}
