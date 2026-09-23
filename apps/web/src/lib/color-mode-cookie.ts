/**
 * Where the colour mode is remembered.
 *
 * A cookie rather than `localStorage`, for one reason that matters: the server
 * renders the page, and only a cookie is readable there. With the preference in
 * `localStorage` the server has to guess, so every navigation paints the wrong
 * theme for a frame and the title screen — which is server rendered and has no
 * shell around it — flashes hardest of all.
 *
 * The value is a *preference*, not a resolved mode. "system" is a real choice
 * and has to survive a reload as itself, or a reader who follows their device
 * would be pinned to whatever their device happened to say the day they first
 * visited.
 */

export const COLOR_MODE_COOKIE = "amb-color-mode";

/** A year. The preference is not sensitive and there is nothing to expire. */
export const COLOR_MODE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

export type ColorMode = "light" | "dark";
export type ColorModePreference = ColorMode | "system";

export const DEFAULT_COLOR_MODE_PREFERENCE: ColorModePreference = "system";

export function isColorModePreference(value: unknown): value is ColorModePreference {
  return value === "light" || value === "dark" || value === "system";
}

export function parseColorModePreference(value: string | undefined): ColorModePreference {
  return isColorModePreference(value) ? value : DEFAULT_COLOR_MODE_PREFERENCE;
}

/**
 * The script that runs before first paint.
 *
 * It exists only for the "system" preference: light and dark are resolved on
 * the server and already on the element. A device set to dark would otherwise
 * get a light first frame, and on the title screen that is a full-window flash.
 *
 * Kept to one statement with no external references so it can be inlined into
 * the document without a nonce-bearing module, and wrapped in try/catch because
 * `matchMedia` is absent in some embedded webviews and a theme must never be
 * the thing that stops a page rendering.
 */
export const COLOR_MODE_SCRIPT = `try{var e=document.documentElement;if(e.dataset.colorModePreference==="system"){var d=window.matchMedia("(prefers-color-scheme: dark)").matches;e.classList.toggle("dark",d);e.style.colorScheme=d?"dark":"light"}}catch(_){}`;
