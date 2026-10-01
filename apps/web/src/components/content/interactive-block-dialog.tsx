"use client";

import { useCallback, useId, useMemo, useState } from "react";
import { Box, Flex, Grid, List, Text } from "@chakra-ui/react";
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
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Modal } from "@/components/ui/modal";
import { TextField } from "@/components/ui/input";
import { TabBar, TabPanel } from "@/components/ui/tabs";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { InteractiveBlock } from "./interactive-block";
import { blockChanged, previewNotice } from "./interactive-block-draft";

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
  const [confirmingDiscard, setConfirmingDiscard] = useState(false);
  const panelId = useId();

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
  const notice = previewNotice({
    previewValid: preview.success,
    draftValid: parsed.success,
    overflowing: overflowing.map((pane) => pane.label),
    firstIssue: parsed.success ? undefined : parsed.error.issues[0]?.message,
  });

  /**
   * Every way out — Cancel, Escape, the close button, a click on the backdrop —
   * asks first when there is something to lose. Three panes of source are an
   * afternoon's work, and one stray click outside the dialog used to discard it.
   */
  function requestClose() {
    if (blockChanged(block, draft)) setConfirmingDiscard(true);
    else onClose();
  }

  return (
    <>
      <Modal
        open={open}
        onOpenChange={(next) => {
          if (!next) requestClose();
        }}
        title="Interactive block"
        size="lg"
        footer={
          <Flex gap="2" justify="flex-end">
            <Button variant="ghost" onClick={requestClose}>
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
                controls={panelId}
              />
              <TabPanel id={panelId} value={activePane}>
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
                      utf8ByteLength(draft[pane.key]) > pane.limit
                        ? "border.error"
                        : "border.default"
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
              </TabPanel>
            </Flex>

            <Flex direction="column" gap="2" minWidth="0">
              <Text fontSize="sm" color="fg.muted">
                Preview
              </Text>
              <Box maxHeight="22rem" overflowY="auto">
                {notice === null && preview.success ? (
                  <InteractiveBlock
                    key={preview.data.id}
                    block={preview.data}
                    onRuntimeError={setRuntimeError}
                    eager
                  />
                ) : (
                  <Text fontSize="sm" color="fg.muted">
                    {notice}
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
                  <Text fontSize="xs" textStyle="data" color="fg.error">
                    {runtimeError}
                  </Text>
                </Box>
              ) : null}
            </Flex>
          </Grid>

          {overflowing.length > 0 ? (
            <Text fontSize="sm" color="fg.error">
              Over the limit: {overflowing.map((pane) => pane.label).join(", ")}. Trim before
              saving.
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

      <ConfirmDialog
        open={confirmingDiscard}
        title="Discard your changes?"
        description="The edits to this interactive block have not been saved into the material."
        confirmLabel="Discard"
        destructive
        onConfirm={() => {
          setConfirmingDiscard(false);
          onClose();
        }}
        onClose={() => setConfirmingDiscard(false)}
      />
    </>
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
      <List.Root fontSize="sm" color="fg.muted" ps="5" gap="0.5">
        <List.Item>
          No network: <code>fetch</code>, <code>XMLHttpRequest</code> and WebSockets are blocked.
          Embed images, media and fonts as data URIs.
        </List.Item>
        <List.Item>
          No <code>localStorage</code>, <code>sessionStorage</code> or cookies.
        </List.Item>
        <List.Item>
          No <code>alert</code>, <code>confirm</code>, <code>prompt</code>, forms, popups,
          downloads, or navigation.
        </List.Item>
        <List.Item>
          Only the theme and reduced-motion preference are available, through{" "}
          <code>window.AmbatucodeBlock</code>. Dark mode sets{" "}
          <code>[data-theme=&quot;dark&quot;]</code>.
        </List.Item>
        <List.Item>Add a text alternative in the material for screen reader users.</List.Item>
      </List.Root>
    </Box>
  );
}

function formatBytes(bytes: number): string {
  return bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KiB`;
}
