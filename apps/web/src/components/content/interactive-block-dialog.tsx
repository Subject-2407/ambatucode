"use client";

import { useCallback, useMemo, useState } from "react";
import { Box, Flex, Grid, Text } from "@chakra-ui/react";
import {
  MAX_BLOCK_BYTES_PER_MATERIAL,
  MAX_BLOCK_CSS_BYTES,
  MAX_BLOCK_HTML_BYTES,
  MAX_BLOCK_JS_BYTES,
  MAX_BLOCKS_PER_MATERIAL,
  interactiveBlockAttrsSchema,
  interactiveBlockByteSize,
  utf8ByteLength,
  type InteractiveBlockAttrs,
} from "@ambatucode/shared";
import { SourceEditor } from "@/components/editor/code-editor";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { TextField } from "@/components/ui/input";
import { TabBar } from "@/components/ui/tabs";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { InteractiveBlock } from "./interactive-block";

/**
 * Authoring an Interactive Block: three source panes and a live preview.
 *
 * The preview is the same `InteractiveBlock` component the Coder gets, with the
 * same sandbox flags and the same assembled document. That is a hard
 * requirement rather than a convenience — a preview even slightly more
 * permissive than delivery would let an Architect publish a block that works
 * here and silently fails for every Coder who opens the Material.
 */

type PaneKey = "html" | "css" | "js";

type Pane = {
  key: PaneKey;
  label: string;
  monaco: string;
  limit: number;
};

const PANES: readonly Pane[] = [
  { key: "html", label: "HTML", monaco: "html", limit: MAX_BLOCK_HTML_BYTES },
  { key: "css", label: "CSS", monaco: "css", limit: MAX_BLOCK_CSS_BYTES },
  { key: "js", label: "JS", monaco: "javascript", limit: MAX_BLOCK_JS_BYTES },
];

export type InteractiveBlockDialogProps = {
  open: boolean;
  /** The block being edited, or a fresh one when inserting. */
  block: InteractiveBlockAttrs;
  onSave: (block: InteractiveBlockAttrs) => void;
  onClose: () => void;
};

export function InteractiveBlockDialog({
  open,
  block,
  onSave,
  onClose,
}: InteractiveBlockDialogProps) {
  const [draft, setDraft] = useState(block);
  const [activePane, setActivePane] = useState<PaneKey>("html");
  const [runtimeError, setRuntimeError] = useState<string | null>(null);

  // Every new document tears the frame down and restarts it, so previewing on
  // each keystroke would never let an animation reach its second frame.
  const debounced = useDebouncedValue(draft, 500);
  const preview = useMemo(() => interactiveBlockAttrsSchema.safeParse(debounced), [debounced]);

  // An error belongs to the version that produced it, so the first keystroke
  // of a fix clears it rather than leaving a stale trace under a live preview.
  const update = useCallback((key: keyof InteractiveBlockAttrs, value: string) => {
    setDraft((current) => ({ ...current, [key]: value }));
    setRuntimeError(null);
  }, []);

  const used = interactiveBlockByteSize(draft);
  const overflowing = PANES.filter((pane) => utf8ByteLength(draft[pane.key]) > pane.limit);
  const parsed = interactiveBlockAttrsSchema.safeParse(draft);
  const canSave = parsed.success && overflowing.length === 0;

  return (
    <Modal
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      title="Interactive block"
      size="lg"
      footer={
        <Flex gap="2" justify="flex-end">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={!canSave}
            onClick={() => {
              if (parsed.success) onSave(parsed.data);
            }}
          >
            Save block
          </Button>
        </Flex>
      }
    >
      <Flex direction="column" gap="4">
        <TextField
          label="Title"
          helperText="Shown in the platform framing around the block."
          value={draft.title}
          maxLength={160}
          placeholder="Binary search visualiser"
          onChange={(event) => update("title", event.target.value)}
        />

        <Grid templateColumns={{ base: "1fr", lg: "1fr 1fr" }} gap="4" alignItems="start">
          <Flex direction="column" gap="2" minWidth="0">
            <TabBar
              aria-label="Block source"
              value={activePane}
              onValueChange={(value) => setActivePane(value as PaneKey)}
              items={PANES.map((pane) => ({
                value: pane.key,
                label: paneLabel(pane, draft[pane.key]),
              }))}
            />
            {PANES.map((pane) => (
              // Every pane stays mounted. Monaco is expensive to create, and
              // unmounting one would throw away the undo history an Architect
              // built up in it.
              <Box
                key={pane.key}
                display={pane.key === activePane ? "block" : "none"}
                height="20rem"
                borderWidth="1px"
                borderColor={
                  utf8ByteLength(draft[pane.key]) > pane.limit ? "border.error" : "border.default"
                }
                borderRadius="md"
                overflow="hidden"
              >
                <SourceEditor
                  monacoLanguage={pane.monaco}
                  tabSize={2}
                  value={draft[pane.key]}
                  onChange={(value) => update(pane.key, value)}
                  ariaLabel={`Interactive block ${pane.label}`}
                />
              </Box>
            ))}
          </Flex>

          <Flex direction="column" gap="2" minWidth="0">
            <Text fontSize="sm" color="fg.muted">
              Preview — the same isolation a Coder gets
            </Text>
            <Box maxHeight="22rem" overflowY="auto">
              {preview.success ? (
                <InteractiveBlock
                  key={preview.data.id}
                  block={preview.data}
                  onRuntimeError={setRuntimeError}
                  eager
                />
              ) : (
                <Text fontSize="sm" color="fg.muted">
                  Fix the fields flagged below to see a preview.
                </Text>
              )}
            </Box>
            {runtimeError ? (
              <Box
                borderWidth="1px"
                borderColor="border.error"
                borderRadius="md"
                bg="bg.error"
                px="3"
                py="2"
              >
                {/* A block has no console of its own; without this an Architect
                    debugging one is completely blind. */}
                <Text fontSize="xs" fontFamily="mono" color="fg.error">
                  {runtimeError}
                </Text>
              </Box>
            ) : null}
          </Flex>
        </Grid>

        {overflowing.length > 0 ? (
          <Text fontSize="sm" color="fg.error">
            Over the limit: {overflowing.map((pane) => pane.label).join(", ")}. Trim before saving.
          </Text>
        ) : (
          <Text fontSize="sm" color="fg.muted">
            {formatBytes(used)} in this block. A material holds at most {MAX_BLOCKS_PER_MATERIAL}{" "}
            blocks and {formatBytes(MAX_BLOCK_BYTES_PER_MATERIAL)} of block content in total.
          </Text>
        )}

        <ConstraintNotice />
      </Flex>
    </Modal>
  );
}

function paneLabel(pane: Pane, value: string): string {
  const bytes = utf8ByteLength(value);
  return bytes === 0 ? pane.label : `${pane.label} · ${formatBytes(bytes)}`;
}

/**
 * Stated plainly and beside the editor, not buried in help.
 *
 * Every constraint here is a wall an Architect would otherwise hit as a silent
 * failure — the frame simply does nothing, with no console and no error to
 * explain why. Saying it up front costs one paragraph and saves an afternoon.
 */
function ConstraintNotice() {
  return (
    <Box borderWidth="1px" borderColor="border.default" borderRadius="md" px="3" py="2">
      <Text fontSize="sm" fontWeight="medium" mb="1">
        What runs here
      </Text>
      <Text fontSize="sm" color="fg.muted">
        No network of any kind: <code>fetch</code>, <code>XMLHttpRequest</code> and WebSockets are
        blocked, and images, media and fonts have to be embedded as data URIs. No{" "}
        <code>localStorage</code>, <code>sessionStorage</code> or cookies. No <code>alert</code>,{" "}
        <code>confirm</code> or <code>prompt</code>. No forms, popups, downloads, or navigation
        outside the frame. The block cannot read the page around it or anything about the Coder
        reading it — only the current theme and their reduced-motion preference, through{" "}
        <code>window.AmbatucodeBlock</code>. Dark mode reaches your CSS as{" "}
        <code>[data-theme=&quot;dark&quot;]</code>.
      </Text>
      <Text fontSize="sm" color="fg.muted" mt="2">
        A block that conveys something no other way needs a text alternative in the material around
        it — a reader using a screen reader gets nothing from a canvas.
      </Text>
    </Box>
  );
}

function formatBytes(bytes: number): string {
  return bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KiB`;
}
