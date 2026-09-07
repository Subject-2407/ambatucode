"use client";

import { forwardRef } from "react";
import {
  Button as ChakraButton,
  IconButton as ChakraIconButton,
  type ButtonProps as ChakraButtonProps,
  type IconButtonProps as ChakraIconButtonProps,
} from "@chakra-ui/react";

/**
 * Buttons default to the accent palette so the primary action on a screen is
 * the one you get for free. Anything else — destructive, quiet, secondary —
 * has to say so, which keeps the "one obvious primary action" rule honest.
 */
export type ButtonProps = ChakraButtonProps;

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(props, ref) {
  return <ChakraButton ref={ref} colorPalette="accent" {...props} />;
});

export type IconButtonProps = ChakraIconButtonProps;

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(
  function IconButton(props, ref) {
    return <ChakraIconButton ref={ref} variant="ghost" colorPalette="accent" {...props} />;
  },
);
