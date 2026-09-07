import { describe, expect, it } from "vitest";
import { USER_ROLES } from "@ambatucode/shared";
import { homePathForRole, routes } from "./routes";

describe("homePathForRole", () => {
  it("gives every role a home", () => {
    for (const role of USER_ROLES) {
      expect(homePathForRole(role), role).toMatch(/^\//);
    }
  });

  it("sends each role to a distinct shell", () => {
    const homes = USER_ROLES.map(homePathForRole);
    expect(new Set(homes).size).toBe(USER_ROLES.length);
  });

  it("keeps the Coder and Architect module trees on separate prefixes", () => {
    // Two route groups claiming `/modules/[...]` with different parameter names
    // is a build error in the App Router, so the prefixes must not collide.
    expect(routes.manageModules.startsWith("/manage/")).toBe(true);
    expect(homePathForRole("CODER").startsWith("/manage/")).toBe(false);
  });

  it("never lands a Coder on an administration path", () => {
    expect(homePathForRole("CODER")).not.toContain("/admin");
    expect(homePathForRole("CODER")).not.toContain("/manage");
  });
});
