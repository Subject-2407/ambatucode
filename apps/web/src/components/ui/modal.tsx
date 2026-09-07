"use client";

import type { ReactNode } from "react";
import { Dialog, Portal } from "@chakra-ui/react";
import { CloseButton } from "./close-button";

export type ModalProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  /** Removes the close affordances so the user must resolve the dialog. */
  blocking?: boolean;
  size?: "xs" | "sm" | "md" | "lg";
};

/**
 * Focus is trapped while open and returned to the trigger on close — Ark's
 * dialog handles both, which is exactly why this wraps it instead of a div.
 *
 * `blocking` exists for the modals the SRS requires a user to acknowledge, such
 * as an auto-submitted attempt: those must not be dismissable by clicking away.
 */
export function Modal({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  blocking = false,
  size = "md",
}: ModalProps) {
  return (
    <Dialog.Root
      open={open}
      onOpenChange={(details) => onOpenChange(details.open)}
      placement="center"
      size={size}
      closeOnInteractOutside={!blocking}
      closeOnEscape={!blocking}
      role="dialog"
    >
      <Portal>
        <Dialog.Backdrop bg="blackAlpha.600" backdropFilter="blur(2px)" />
        <Dialog.Positioner>
          <Dialog.Content bg="bg.surface" borderColor="border.default" boxShadow="popover">
            <Dialog.Header>
              <Dialog.Title>{title}</Dialog.Title>
            </Dialog.Header>
            {!blocking && (
              <Dialog.CloseTrigger asChild>
                <CloseButton position="absolute" top="3" insetEnd="3" />
              </Dialog.CloseTrigger>
            )}
            <Dialog.Body>
              {description ? (
                <Dialog.Description color="fg.muted" mb={children ? "4" : undefined}>
                  {description}
                </Dialog.Description>
              ) : null}
              {children}
            </Dialog.Body>
            {footer ? <Dialog.Footer>{footer}</Dialog.Footer> : null}
          </Dialog.Content>
        </Dialog.Positioner>
      </Portal>
    </Dialog.Root>
  );
}
