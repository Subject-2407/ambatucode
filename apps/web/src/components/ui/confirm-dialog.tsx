"use client";

import type { ReactNode } from "react";
import { Button } from "./button";
import { Modal } from "./modal";

/**
 * A decision the user has to make deliberately.
 *
 * It exists so destructive actions look like the rest of the product rather
 * than like the browser: `window.confirm` cannot be styled, cannot be reached
 * by the same focus rules, and reads as something the page did wrong.
 */
export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = "Confirm",
  destructive = false,
  loading = false,
  onConfirm,
  onClose,
}: {
  open: boolean;
  title: string;
  description: ReactNode;
  confirmLabel?: string;
  destructive?: boolean;
  loading?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <Modal
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      size="sm"
      title={title}
      description={description}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={loading}>
            Cancel
          </Button>
          <Button
            colorPalette={destructive ? "danger" : "accent"}
            onClick={onConfirm}
            loading={loading}
            autoFocus
          >
            {confirmLabel}
          </Button>
        </>
      }
    />
  );
}
