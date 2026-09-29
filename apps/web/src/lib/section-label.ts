/**
 * How a Section is named above a page inside it: "02 · Loops".
 *
 * Zero-padded because that is how the module overview numbers its Sections, so
 * the label over a Material is the same string the Coder clicked past to reach
 * it.
 */
export function sectionNumberLabel(sectionNumber: number): string {
  return String(sectionNumber).padStart(2, "0");
}

export function sectionLabel(section: { sectionNumber: number; sectionTitle: string }): string {
  return `${sectionNumberLabel(section.sectionNumber)} · ${section.sectionTitle}`;
}
