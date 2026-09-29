import { describe, expect, it } from "vitest";
import { CONTENTS_PANEL_COOKIE, contentsPanelCookie, parseContentsPanel } from "./contents-panel";

describe("parseContentsPanel", () => {
  it("reads both settings", () => {
    expect(parseContentsPanel("shown")).toBe(true);
    expect(parseContentsPanel("hidden")).toBe(false);
  });

  it("shows the sidebar for a missing or tampered cookie", () => {
    expect(parseContentsPanel(undefined)).toBe(true);
    expect(parseContentsPanel("")).toBe(true);
    expect(parseContentsPanel("HIDDEN")).toBe(true);
    expect(parseContentsPanel("<script>")).toBe(true);
  });
});

describe("contentsPanelCookie", () => {
  it("round-trips through the parser", () => {
    const value = (cookie: string) => cookie.split(";")[0]?.split("=")[1];
    expect(parseContentsPanel(value(contentsPanelCookie(false)))).toBe(false);
    expect(parseContentsPanel(value(contentsPanelCookie(true)))).toBe(true);
  });

  it("is site-wide, lasting, and sent only on first-party navigation", () => {
    const cookie = contentsPanelCookie(true);
    expect(cookie.startsWith(`${CONTENTS_PANEL_COOKIE}=shown;`)).toBe(true);
    expect(cookie).toContain("path=/");
    expect(cookie).toMatch(/max-age=\d+/);
    expect(cookie).toContain("SameSite=Lax");
  });
});
