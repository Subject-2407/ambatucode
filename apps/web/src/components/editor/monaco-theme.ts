import { colors } from "@/theme/colors";

/**
 * Monaco's themes, generated from the same ramps as the rest of the app.
 *
 * Monaco paints itself with literal colours — it cannot read a CSS variable, so
 * it cannot participate in the semantic token layer. Reading the ramps directly
 * here is the next best thing: there is still one place the brand is defined,
 * and a ramp change reaches the editor without anybody remembering to update a
 * second list of hexes.
 *
 * The editor deliberately does not get the pixel treatment. Its text stays on
 * the mono stack at a normal weight, because a pixel face in a code editor is a
 * readability bug wearing a costume — a Coder has to be able to tell `l` from
 * `1` and `{` from `(` under exam pressure.
 */

type Ramp = { [stop: number]: { value: string } };

/** Monaco wants `#rrggbb` for UI colours and bare `rrggbb` for token rules. */
function hex(ramp: Ramp, stop: number): string {
  return ramp[stop]?.value ?? "#000000";
}
function bare(ramp: Ramp, stop: number): string {
  return hex(ramp, stop).replace("#", "");
}

const { brand, bone, crimson, lagoon, gold, plum } = colors;

export const MONACO_THEME_DARK = "ambatucode-dark";
export const MONACO_THEME_LIGHT = "ambatucode-light";

/** The shape `monaco.editor.defineTheme` takes, without importing Monaco's types. */
export type MonacoThemeData = {
  base: "vs" | "vs-dark";
  inherit: boolean;
  rules: Array<{ token: string; foreground?: string; fontStyle?: string }>;
  colors: Record<string, string>;
};

export const monacoThemes: Readonly<Record<string, MonacoThemeData>> = {
  [MONACO_THEME_DARK]: {
    base: "vs-dark",
    inherit: true,
    rules: [
      { token: "comment", foreground: bare(brand, 400) },
      { token: "keyword", foreground: bare(crimson, 400) },
      { token: "keyword.control", foreground: bare(crimson, 400) },
      { token: "string", foreground: bare(gold, 400) },
      { token: "number", foreground: bare(gold, 300) },
      { token: "type", foreground: bare(lagoon, 300) },
      { token: "type.identifier", foreground: bare(lagoon, 300) },
      { token: "function", foreground: bare(lagoon, 400) },
      { token: "variable", foreground: bare(bone, 200) },
    ],
    colors: {
      "editor.background": hex(brand, 950),
      "editor.foreground": hex(bone, 200),
      "editor.lineHighlightBackground": hex(brand, 900),
      "editor.selectionBackground": hex(brand, 800),
      "editorLineNumber.foreground": hex(brand, 700),
      "editorLineNumber.activeForeground": hex(lagoon, 400),
      "editorCursor.foreground": hex(lagoon, 400),
      "editorIndentGuide.background1": hex(brand, 800),
      "editorWhitespace.foreground": hex(brand, 800),
      "editorWidget.background": hex(brand, 900),
      "editorWidget.border": hex(brand, 700),
      "editorGutter.background": hex(brand, 950),
    },
  },

  [MONACO_THEME_LIGHT]: {
    base: "vs",
    inherit: true,
    rules: [
      { token: "comment", foreground: bare(brand, 700) },
      { token: "keyword", foreground: bare(crimson, 700) },
      { token: "keyword.control", foreground: bare(crimson, 700) },
      // The ink form of gold, not the fill: #e8b33c on paper is 1.5:1.
      { token: "string", foreground: bare(gold, 700) },
      { token: "number", foreground: bare(gold, 800) },
      { token: "type", foreground: bare(plum, 700) },
      { token: "type.identifier", foreground: bare(plum, 700) },
      { token: "function", foreground: bare(lagoon, 700) },
      { token: "variable", foreground: bare(brand, 950) },
    ],
    colors: {
      // bg.surface in light, so the editor sits on the same paper as the panel
      // around it instead of punching a white hole in it.
      "editor.background": hex(bone, 100),
      "editor.foreground": hex(brand, 950),
      "editor.lineHighlightBackground": hex(bone, 200),
      "editor.selectionBackground": hex(bone, 400),
      "editorLineNumber.foreground": hex(brand, 700),
      "editorLineNumber.activeForeground": hex(brand, 900),
      "editorCursor.foreground": hex(brand, 900),
      "editorIndentGuide.background1": hex(bone, 400),
      "editorWhitespace.foreground": hex(bone, 400),
      "editorWidget.background": hex(bone, 100),
      "editorWidget.border": hex(brand, 800),
      "editorGutter.background": hex(bone, 100),
    },
  },
};

export function monacoThemeFor(colorMode: "light" | "dark"): string {
  return colorMode === "dark" ? MONACO_THEME_DARK : MONACO_THEME_LIGHT;
}
