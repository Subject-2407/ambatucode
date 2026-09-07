"use client";

import { forwardRef } from "react";
import { X } from "lucide-react";
import { IconButton, type IconButtonProps } from "./button";

export type CloseButtonProps = Omit<IconButtonProps, "children">;

export const CloseButton = forwardRef<HTMLButtonElement, CloseButtonProps>(function CloseButton(
  { "aria-label": ariaLabel = "Close", ...props },
  ref,
) {
  return (
    <IconButton ref={ref} aria-label={ariaLabel} size="sm" {...props}>
      <X aria-hidden />
    </IconButton>
  );
});
