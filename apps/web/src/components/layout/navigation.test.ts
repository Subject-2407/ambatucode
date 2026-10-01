import { describe, expect, it } from "vitest";
import { isNavItemActive, navItemsForRole, type NavItem } from "./navigation";

function item(role: Parameters<typeof navItemsForRole>[0], label: string): NavItem {
  const found = navItemsForRole(role).find((entry) => entry.label === label);
  if (!found) throw new Error(`no ${label} item for ${role}`);
  return found;
}

describe("isNavItemActive", () => {
  const modules = item("ARCHITECT", "Modules");
  const monitor = item("ARCHITECT", "Monitor");

  it("lights an item on its own page and beneath it", () => {
    expect(isNavItemActive("/manage/modules", modules)).toBe(true);
    expect(isNavItemActive("/manage/modules/abc/builder", modules)).toBe(true);
  });

  it("keeps Modules lit while an Assessment from a Module is being edited", () => {
    expect(isNavItemActive("/manage/assessments/abc", modules)).toBe(true);
    expect(isNavItemActive("/manage/assessments/abc", monitor)).toBe(false);
  });

  it("matches whole path segments only", () => {
    expect(isNavItemActive("/manage/modules-archive", modules)).toBe(false);
    expect(isNavItemActive("/manage/assessmentsX", modules)).toBe(false);
  });

  it("leaves other destinations alone", () => {
    expect(isNavItemActive("/manage/monitor", modules)).toBe(false);
    expect(isNavItemActive("/manage/monitor", monitor)).toBe(true);
  });
});
