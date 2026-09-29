import { z } from "zod";

/**
 * How a Coder likes a Module's Sections laid out.
 *
 * - `list` — one centred column, read top to bottom.
 * - `columns` — the Sections beside a panel about the Module.
 * - `grid` — each Section a card, several to a row.
 *
 * A cookie, for the reason the colour mode is one: the overview is rendered on
 * the server, and only a cookie is readable there. Kept in `localStorage`, every
 * visit would paint the default layout and then jump to the chosen one.
 *
 * One preference for every Module, not one each. It is a way of reading, and a
 * Coder who likes the grid should not have to ask for it Module by Module.
 */

export const MODULE_VIEWS = ["list", "columns", "grid"] as const;
export type ModuleView = (typeof MODULE_VIEWS)[number];

export const MODULE_VIEW_COOKIE = "amb-module-view";

/** A year. Nothing sensitive is stored, and nothing needs to expire. */
export const MODULE_VIEW_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

export const DEFAULT_MODULE_VIEW: ModuleView = "list";

const moduleViewSchema = z.enum(MODULE_VIEWS);

/** A cookie is input from the browser like any other, so it is parsed. */
export function parseModuleView(value: string | undefined): ModuleView {
  const parsed = moduleViewSchema.safeParse(value);
  return parsed.success ? parsed.data : DEFAULT_MODULE_VIEW;
}

export function moduleViewCookie(view: ModuleView): string {
  return `${MODULE_VIEW_COOKIE}=${view}; path=/; max-age=${String(MODULE_VIEW_COOKIE_MAX_AGE)}; SameSite=Lax`;
}
