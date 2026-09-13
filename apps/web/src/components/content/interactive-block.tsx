"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Badge, Box, Flex, Text } from "@chakra-ui/react";
import { TriangleAlert } from "lucide-react";
import {
  BLOCK_CONTEXT_MESSAGE,
  BLOCK_RESIZE_MESSAGE,
  blockOutboundMessageSchema,
  clampBlockHeight,
  interactiveBlockAttrsSchema,
  type BlockContextMessage,
  type InteractiveBlockAttrs,
  type RichTextNode,
} from "@ambatucode/shared";
import { useColorMode } from "@/providers/color-mode";
import { INTERACTIVE_BLOCK_SANDBOX, assembleInteractiveBlock } from "@/lib/interactive-block";

/**
 * The one component that runs an Interactive Block, used by both the Material
 * reader and the authoring preview.
 *
 * They share it deliberately. A preview that were even slightly more permissive
 * than delivery would let an Architect publish a block that works for them and
 * silently fails for every Coder — so there is one frame, one set of sandbox
 * flags, one assembled document, and no second code path to drift.
 */

/** How many resizes in one second count as a block fighting its own height. */
const OSCILLATION_LIMIT = 12;
const OSCILLATION_WINDOW_MS = 1000;

export type InteractiveBlockProps = {
  block: InteractiveBlockAttrs;
  /** Authoring surfaces want runtime failures; the reader deliberately does not. */
  onRuntimeError?: (message: string) => void;
  /** The preview is always on screen and should not wait to be scrolled to. */
  eager?: boolean;
};

export function InteractiveBlock({ block, onRuntimeError, eager = false }: InteractiveBlockProps) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(block.initialHeight);
  const { colorMode } = useColorMode();

  const reducedMotion = usePrefersReducedMotion();

  // Re-assembling tears the frame down and restarts it from nothing, losing
  // whatever state the block had built up — a half-played animation, a
  // step-through the reader was partway into. So the string is rebuilt only
  // when the content or the theme genuinely changed.
  const srcDoc = useMemo(
    () =>
      assembleInteractiveBlock(block, {
        theme: colorMode,
        reducedMotion,
      }),
    [block, colorMode, reducedMotion],
  );

  // Memoized so the context effect does not re-post on every render; the frame
  // only needs telling when one of these two actually changes.
  const context: BlockContextMessage = useMemo(
    () => ({ type: BLOCK_CONTEXT_MESSAGE, theme: colorMode, reducedMotion }),
    [colorMode, reducedMotion],
  );

  useBlockBridge({ frameRef, onHeight: setHeight, onRuntimeError, context });

  return (
    <BlockFrame title={block.title}>
      <iframe
        key={block.id}
        ref={frameRef}
        srcDoc={srcDoc}
        sandbox={INTERACTIVE_BLOCK_SANDBOX}
        referrerPolicy="no-referrer"
        loading={eager ? "eager" : "lazy"}
        allow=""
        title={block.title || "Interactive content"}
        style={{ width: "100%", border: 0, height: `${height}px`, display: "block" }}
      />
    </BlockFrame>
  );
}

/**
 * Renders an `interactiveBlock` node straight out of a stored document.
 *
 * The node's attrs are untyped as far as the rich text schema is concerned, so
 * they are parsed here before anything is rendered. An invalid block becomes an
 * inline notice and the Material keeps going — one bad block must never take a
 * whole lesson down with it.
 */
export function InteractiveBlockNode({ node }: { node: RichTextNode }) {
  const parsed = interactiveBlockAttrsSchema.safeParse(node.attrs ?? {});

  if (!parsed.success) {
    return (
      <BlockFrame title="">
        <BlockNotice message="This interactive block could not be loaded. Its author will need to fix it." />
      </BlockFrame>
    );
  }

  return <InteractiveBlock block={parsed.data} />;
}

/**
 * Visible platform framing, always.
 *
 * The sandbox flags cannot stop a block from *looking* like the platform, so
 * this is the mitigation for impersonation: a bordered surface and a label that
 * says what the reader is looking at. Never full-bleed, never chromeless — a
 * Coder must be able to tell platform interface from authored content at every
 * moment, so that a block can never present itself as a system prompt or a
 * credential form.
 */
function BlockFrame({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Box
      borderWidth="1px"
      borderColor="border.default"
      borderRadius="md"
      overflow="hidden"
      bg="bg.surface"
    >
      <Flex
        align="center"
        gap="2"
        px="3"
        py="2"
        borderBottomWidth="1px"
        borderColor="border.default"
        bg="bg.subtle"
      >
        <Badge size="sm" variant="subtle">
          Interactive block
        </Badge>
        {title ? (
          <Text fontSize="sm" color="fg.muted" lineClamp={1}>
            {title}
          </Text>
        ) : null}
      </Flex>
      {children}
    </Box>
  );
}

function BlockNotice({ message }: { message: string }) {
  return (
    <Flex align="center" gap="2" px="3" py="4" color="fg.muted">
      <TriangleAlert size={16} aria-hidden />
      <Text fontSize="sm">{message}</Text>
    </Flex>
  );
}

type BridgeOptions = {
  frameRef: React.RefObject<HTMLIFrameElement | null>;
  onHeight: (height: number) => void;
  onRuntimeError?: (message: string) => void;
  context: BlockContextMessage;
};

/**
 * The host half of the bridge.
 *
 * Two rules carry the whole thing. The sender is identified by comparing
 * `event.source` against the frame's own `contentWindow` — never by origin,
 * because every sandboxed frame on the page reports `event.origin === "null"`,
 * a hostile one included, so origin cannot tell them apart. And the payload is
 * parsed with Zod before a single field is read, since `event.data` is
 * attacker-controlled by definition.
 */
function useBlockBridge({ frameRef, onHeight, onRuntimeError, context }: BridgeOptions) {
  const frozenRef = useRef(false);
  const recentRef = useRef<number[]>([]);

  // Held in a ref and refreshed in an effect so the message listener can call
  // the latest callback without being torn down and rebuilt every render — a
  // listener that unsubscribes mid-flight drops the resize it was waiting for.
  const errorRef = useRef(onRuntimeError);
  useEffect(() => {
    errorRef.current = onRuntimeError;
  }, [onRuntimeError]);

  const applyHeight = useCallback(
    (raw: number) => {
      if (frozenRef.current) return;

      // A block whose content reacts to its own height will otherwise
      // oscillate forever, resizing the page on every frame. After enough
      // changes in one second the height is frozen where it stands.
      const now = Date.now();
      const recent = recentRef.current.filter((at) => now - at < OSCILLATION_WINDOW_MS);
      recent.push(now);
      recentRef.current = recent;

      if (recent.length > OSCILLATION_LIMIT) {
        frozenRef.current = true;
        return;
      }

      // Inside a frame, so the page is not laid out mid-message.
      requestAnimationFrame(() => onHeight(clampBlockHeight(raw)));
    },
    [onHeight],
  );

  useEffect(() => {
    function onMessage(event: MessageEvent) {
      if (event.source !== frameRef.current?.contentWindow) return;

      const parsed = blockOutboundMessageSchema.safeParse(event.data);
      if (!parsed.success) return;

      if (parsed.data.type === BLOCK_RESIZE_MESSAGE) {
        applyHeight(parsed.data.height);
        return;
      }
      errorRef.current?.(parsed.data.message);
    }

    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [frameRef, applyHeight]);

  // Theme and reduced motion, and nothing else, ever. The target has to be "*"
  // because an opaque origin cannot be named — which means anything posted here
  // is effectively public, so the Coder's identity, module, progress, and any
  // token must never travel on this channel.
  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;

    const send = () => frame.contentWindow?.postMessage(context, "*");
    frame.addEventListener("load", send);
    send();
    return () => frame.removeEventListener("load", send);
  }, [frameRef, context]);
}

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

function subscribeToReducedMotion(onChange: () => void): () => void {
  const query = window.matchMedia(REDUCED_MOTION_QUERY);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

/**
 * Passed into the frame so Architects can honour it; it cannot be enforced
 * there, because the platform has no reach inside an opaque origin.
 *
 * Read through `useSyncExternalStore` rather than an effect: the preference is
 * external state that exists before the first render, and syncing it into
 * state afterwards would render once with the wrong answer and animate a frame
 * at somebody who asked for stillness.
 */
function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(
    subscribeToReducedMotion,
    () => window.matchMedia(REDUCED_MOTION_QUERY).matches,
    // The server has no preference to read, and no motion to suppress.
    () => false,
  );
}
