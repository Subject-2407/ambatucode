"use client";

import { useState, type ReactNode } from "react";
import { Box, Flex, Grid } from "@chakra-ui/react";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { contentsPanelCookie } from "@/lib/contents-panel";

const CONTENTS_ID = "module-contents";

/**
 * A Material's page: the reading column, and the Module contents beside it
 * when the Coder wants them.
 *
 * The sidebar is a help for moving around a Module, and while reading it is
 * one more thing at the edge of the eye. So it can be put away, and the choice
 * is remembered for every Material. With it hidden the reading column centres
 * on its own.
 *
 * The switch exists only where the sidebar does, on wide screens. Below that
 * the sidebar is never drawn and the back link is the way around.
 */
export function MaterialLayout({
  contents,
  back,
  initialShown,
  children,
}: {
  contents: ReactNode;
  back: ReactNode;
  /** From the cookie, so the server already rendered the right layout. */
  initialShown: boolean;
  children: ReactNode;
}) {
  const [shown, setShown] = useState(initialShown);

  function toggle() {
    const next = !shown;
    setShown(next);
    document.cookie = contentsPanelCookie(next);
  }

  return (
    <Grid
      templateColumns={{
        base: "minmax(0, 1fr)",
        xl: shown ? "15rem minmax(0, 52rem)" : "minmax(0, 52rem)",
      }}
      justifyContent="center"
      columnGap="10"
      alignItems="start"
    >
      {/* Kept mounted while hidden, so the switch always has the region it
          controls to point at. */}
      <Box id={CONTENTS_ID} hidden={!shown} display={shown ? "block" : "none"} minWidth="0">
        {contents}
      </Box>

      {/* A reading measure, centred. Prose that runs the full width of a wide
          monitor is a line the eye cannot find the start of again. */}
      <Box width="full" maxWidth="52rem" marginX="auto" minWidth="0">
        <Flex justify="space-between" align="start" gap="3">
          {back}
          <Button
            variant="ghost"
            size="sm"
            color="fg.muted"
            display={{ base: "none", xl: "inline-flex" }}
            me="-3.5"
            onClick={toggle}
            aria-expanded={shown}
            aria-controls={CONTENTS_ID}
            // The recipe tints an expanded ghost button, which suits a menu
            // trigger. Here "expanded" is the resting state, and it looked
            // like a button stuck under the pointer.
            _expanded={{ bg: "transparent", _hover: { bg: "colorPalette.subtle" } }}
          >
            {shown ? <PanelLeftClose aria-hidden /> : <PanelLeftOpen aria-hidden />}
            {shown ? "Hide contents" : "Show contents"}
          </Button>
        </Flex>
        {children}
      </Box>
    </Grid>
  );
}
