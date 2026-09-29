"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";
import dynamic from "next/dynamic";
import { Box, Skeleton } from "@chakra-ui/react";
import { loader, type OnMount } from "@monaco-editor/react";
import type * as MonacoApi from "monaco-editor";
import type { Language } from "@ambatucode/shared";
import { useColorMode } from "@/providers/color-mode";
import { MONACO_LANGUAGE_ID, TAB_SIZE } from "./language-labels";
import { monacoThemeFor, monacoThemes } from "./monaco-theme";
import { createValueSync } from "./value-sync";

/**
 * The Monaco wrapper. Every editor in the product goes through it.
 *
 * Two things are settled here rather than at each call site. Monaco is loaded
 * from `/monaco/vs`, which `scripts/vendor-monaco.mjs` fills from the installed
 * package — the default CDN would leave a lab machine with no internet staring
 * at an empty panel. And the editor itself is imported dynamically with
 * `ssr: false`, because it is the heaviest thing in the bundle and it has
 * nothing to render on the server.
 */

loader.config({ paths: { vs: "/monaco/vs" } });

const MonacoEditor = dynamic(() => import("@monaco-editor/react").then((monaco) => monaco.Editor), {
  ssr: false,
  loading: () => <Skeleton height="100%" width="100%" />,
});

type SourceEditorProps = {
  /**
   * A Monaco grammar id rather than a product `Language`.
   *
   * The Interactive Block authoring dialog edits HTML, CSS, and JavaScript —
   * none of which is a sandbox language, and two of which never will be. They
   * still have to come through here so there is one vendored Monaco, one theme
   * binding, and one set of options in the product.
   */
  monacoLanguage: string;
  tabSize: number;
  value: string;
  onChange: (value: string) => void;
  readOnly?: boolean;
  height?: string;
  blockContextMenu?: boolean;
  ariaLabel?: string;
  autoFocus?: boolean;
};

export function SourceEditor({
  monacoLanguage,
  tabSize,
  value,
  onChange,
  readOnly = false,
  height = "100%",
  blockContextMenu = false,
  ariaLabel = "Code editor",
  autoFocus = false,
}: SourceEditorProps) {
  const { colorMode } = useColorMode();

  const options = useMemo(
    () => ({
      readOnly,
      contextmenu: !blockContextMenu,
      tabSize,
      insertSpaces: true,
      minimap: { enabled: false },
      // Ligatures off: a lab projector and an unfamiliar font turn `!==` into
      // a glyph a beginner cannot type back.
      fontLigatures: false,
      fontFamily: "var(--amb-fonts-mono)",
      fontSize: 14,
      lineNumbersMinChars: 3,
      scrollBeyondLastLine: false,
      automaticLayout: true,
      renderWhitespace: "selection" as const,
      ariaLabel,
    }),
    [ariaLabel, blockContextMenu, readOnly, tabSize],
  );

  /**
   * Monaco owns the text; `value` is only how a parent changes it from outside.
   *
   * It used to be passed straight through as a controlled value, and the
   * wrapper rewrote the whole document whenever the prop differed from the
   * model. Typing fast, the prop is always a keystroke or two behind, so every
   * lagging render replaced the buffer with an older copy: the caret jumped to
   * the end of the file and the newest characters vanished. The wrapper is
   * handed only the initial text now, and changes are reconciled here — see
   * `value-sync.ts` for how an echo is told apart from a real change.
   */
  const editorRef = useRef<MonacoApi.editor.IStandaloneCodeEditor | null>(null);
  const sync = useRef(createValueSync());
  const latestValue = useRef(value);
  const onChangeRef = useRef(onChange);
  /** Set while this component writes into the model, so that write is not reported back. */
  const applying = useRef(false);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  const applyExternal = useCallback((next: string) => {
    const editor = editorRef.current;
    const model = editor?.getModel();
    if (!editor || !model) return;
    if (!sync.current.shouldApply(next, model.getValue())) return;

    // An edit rather than `setValue`, so it lands on the undo stack and the
    // Coder can take a reset or a language switch back with Ctrl+Z. The caret
    // stays where it was, clamped to the new text, instead of being thrown to
    // the end.
    const position = editor.getPosition();
    applying.current = true;
    try {
      editor.pushUndoStop();
      model.pushEditOperations([], [{ range: model.getFullModelRange(), text: next }], () => null);
      editor.pushUndoStop();
    } finally {
      applying.current = false;
    }
    if (position) editor.setPosition(model.validatePosition(position));
  }, []);

  useEffect(() => {
    latestValue.current = value;
    applyExternal(value);
  }, [applyExternal, value]);

  const handleChange = useCallback((next: string | undefined) => {
    if (applying.current) return;
    const text = next ?? "";
    sync.current.emitted(text);
    onChangeRef.current(text);
  }, []);

  const handleMount = useCallback<OnMount>(
    (editor) => {
      editorRef.current = editor;
      // Monaco loads asynchronously, and the parent may have changed the text
      // while it did — a recovered draft, most often. Catch up once.
      applyExternal(latestValue.current);
      if (autoFocus) editor.focus();
    },
    [applyExternal, autoFocus],
  );

  // Themes have to exist before the editor asks for one by name, and
  // `beforeMount` is the only hook that runs early enough.
  // Typed against monaco-editor directly rather than the wrapper's `BeforeMount`,
  // whose monaco parameter resolves to `any` here and would make every call
  // through it unchecked.
  const handleBeforeMount = useCallback((monaco: typeof MonacoApi) => {
    for (const [name, data] of Object.entries(monacoThemes)) {
      monaco.editor.defineTheme(name, data);
    }
  }, []);

  return (
    <Box height={height} minHeight="16rem" overflow="hidden" borderRadius="0">
      <MonacoEditor
        language={monacoLanguage}
        theme={monacoThemeFor(colorMode)}
        defaultValue={value}
        onChange={handleChange}
        beforeMount={handleBeforeMount}
        onMount={handleMount}
        options={options}
        height="100%"
        loading={<Skeleton height="100%" width="100%" />}
      />
    </Box>
  );
}

export type CodeEditorProps = {
  language: Language;
  value: string;
  onChange: (value: string) => void;
  readOnly?: boolean;
  height?: string;
  /** Suppresses Monaco's own context menu when an Assessment configures it. */
  blockContextMenu?: boolean;
  ariaLabel?: string;
  /**
   * Takes focus once the editor has loaded.
   *
   * Off by default, and deliberately so: Monaco finishes loading a beat after
   * the surrounding form, and an editor that grabs focus then steals the
   * keystrokes of whoever was already typing in another field. Only a screen
   * where the editor *is* the task should turn this on.
   */
  autoFocus?: boolean;
};

/** The editor a Coder writes sandbox-language source in. */
export function CodeEditor({ language, ...rest }: CodeEditorProps) {
  return (
    <SourceEditor
      monacoLanguage={MONACO_LANGUAGE_ID[language]}
      tabSize={TAB_SIZE[language]}
      {...rest}
    />
  );
}
