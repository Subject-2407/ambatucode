import { z } from "zod";

/**
 * Whether the Module contents sidebar beside a Material is shown.
 *
 * A cookie, because the Material page is rendered on the server and only a
 * cookie is readable there. Kept in `localStorage`, a Coder who hid the
 * sidebar would see it appear and then vanish on every Material they opened.
 *
 * One setting for every Module: it is a way of reading, not a fact about any
 * one Module.
 */

export const CONTENTS_PANEL_COOKIE = "amb-contents-panel";

/** A year. Nothing sensitive is stored, and nothing needs to expire. */
export const CONTENTS_PANEL_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

const contentsPanelSchema = z.enum(["shown", "hidden"]);

/** A cookie is input from the browser like any other, so it is parsed. Shown by default. */
export function parseContentsPanel(value: string | undefined): boolean {
  const parsed = contentsPanelSchema.safeParse(value);
  return !parsed.success || parsed.data === "shown";
}

export function contentsPanelCookie(shown: boolean): string {
  return `${CONTENTS_PANEL_COOKIE}=${shown ? "shown" : "hidden"}; path=/; max-age=${String(CONTENTS_PANEL_COOKIE_MAX_AGE)}; SameSite=Lax`;
}
