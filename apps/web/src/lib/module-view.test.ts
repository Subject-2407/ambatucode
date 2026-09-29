import { describe, expect, it } from "vitest";
import {
  DEFAULT_MODULE_VIEW,
  MODULE_VIEW_COOKIE,
  moduleViewCookie,
  parseModuleView,
} from "./module-view";

describe("parseModuleView", () => {
  it("accepts every layout the overview offers", () => {
    expect(parseModuleView("list")).toBe("list");
    expect(parseModuleView("columns")).toBe("columns");
    expect(parseModuleView("grid")).toBe("grid");
  });

  it("falls back to the default for a missing or tampered cookie", () => {
    expect(parseModuleView(undefined)).toBe(DEFAULT_MODULE_VIEW);
    expect(parseModuleView("")).toBe(DEFAULT_MODULE_VIEW);
    expect(parseModuleView("GRID")).toBe(DEFAULT_MODULE_VIEW);
    expect(parseModuleView("<script>")).toBe(DEFAULT_MODULE_VIEW);
  });
});

describe("moduleViewCookie", () => {
  it("is site-wide, lasting, and sent only on first-party navigation", () => {
    const cookie = moduleViewCookie("grid");
    expect(cookie.startsWith(`${MODULE_VIEW_COOKIE}=grid;`)).toBe(true);
    expect(cookie).toContain("path=/");
    expect(cookie).toMatch(/max-age=\d+/);
    expect(cookie).toContain("SameSite=Lax");
  });
});
