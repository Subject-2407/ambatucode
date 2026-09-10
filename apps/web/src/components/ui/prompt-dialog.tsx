"use client";

import { useState, type FormEvent } from "react";
import { Button } from "./button";
import { TextField } from "./input";
import { Modal } from "./modal";

/**
 * Asks for a single line of text — a section title, a link.
 *
 * The value lives here rather than in the caller so a cancelled dialog leaves
 * nothing behind, and the caller mounts it only while open, which is what
 * makes `initialValue` reliable as a seed.
 */
export function PromptDialog({
  title,
  label,
  initialValue = "",
  placeholder,
  helperText,
  confirmLabel = "Save",
  loading = false,
  onConfirm,
  onClose,
}: {
  title: string;
  label: string;
  initialValue?: string;
  placeholder?: string;
  helperText?: string;
  confirmLabel?: string;
  loading?: boolean;
  onConfirm: (value: string) => void;
  onClose: () => void;
}) {
  const [value, setValue] = useState(initialValue);
  const trimmed = value.trim();

  function submit(event: FormEvent) {
    event.preventDefault();
    if (trimmed === "") return;
    onConfirm(trimmed);
  }

  return (
    <Modal
      open
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      size="sm"
      title={title}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={loading}>
            Cancel
          </Button>
          <Button onClick={() => onConfirm(trimmed)} disabled={trimmed === ""} loading={loading}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <form onSubmit={submit}>
        <TextField
          label={label}
          value={value}
          onChange={(event) => setValue(event.currentTarget.value)}
          placeholder={placeholder}
          helperText={helperText}
          autoFocus
        />
      </form>
    </Modal>
  );
}
