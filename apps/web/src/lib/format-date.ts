/**
 * Every date and time a Coder reads, in one format.
 *
 * Screens used to format their own — `toLocaleString()` with the browser's
 * defaults on one, `en-GB` with a short month on the next — so the same moment
 * read "21/09/2026, 17:00:00" in one place and "21 Sept 2026, 17:00" in
 * another. One formatter is one answer.
 *
 * `en-GB` because its day-month-year order is the one the platform's users
 * read without thinking, and fixing the locale keeps a server render and the
 * browser's hydration from disagreeing about the words.
 */

const DATE: Intl.DateTimeFormatOptions = { day: "2-digit", month: "short", year: "numeric" };
const TIME: Intl.DateTimeFormatOptions = { hour: "2-digit", minute: "2-digit" };

type DateInput = string | number | Date;

/** "21 Sept 2026, 17:00" */
export function formatDateTime(value: DateInput): string {
  return new Date(value).toLocaleString("en-GB", { ...DATE, ...TIME });
}

/** "21 Sept 2026" */
export function formatDate(value: DateInput): string {
  return new Date(value).toLocaleDateString("en-GB", DATE);
}

/** "17:00:08" — seconds included, for the one place they matter: an autosave. */
export function formatTimeWithSeconds(value: DateInput): string {
  return new Date(value).toLocaleTimeString("en-GB", { ...TIME, second: "2-digit" });
}
