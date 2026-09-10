import { describe, expect, it } from "vitest";
import {
  createModuleRequestSchema,
  listModulesQuerySchema,
  moduleSlugSchema,
  updateModuleRequestSchema,
} from "./modules";

describe("moduleSlugSchema", () => {
  it("accepts a readable lower-case slug", () => {
    expect(moduleSlugSchema.parse("python-foundations")).toBe("python-foundations");
  });

  it.each(["Python-Foundations", "python--foundations", "-python", "python-", "py"])(
    "rejects %s",
    (value) => {
      expect(moduleSlugSchema.safeParse(value).success).toBe(false);
    },
  );
});

describe("createModuleRequestSchema", () => {
  it("defaults a new module to public and unpublished", () => {
    const parsed = createModuleRequestSchema.parse({ title: "Python Foundations" });
    expect(parsed.visibility).toBe("PUBLIC");
    expect(parsed.isPublished).toBe(false);
  });

  it("leaves the slug absent so the server can derive it", () => {
    expect(createModuleRequestSchema.parse({ title: "Python Foundations" }).slug).toBeUndefined();
  });
});

describe("updateModuleRequestSchema", () => {
  it("rejects an empty patch", () => {
    expect(updateModuleRequestSchema.safeParse({}).success).toBe(false);
  });

  it("accepts clearing the description", () => {
    expect(updateModuleRequestSchema.parse({ description: null }).description).toBeNull();
  });
});

describe("listModulesQuerySchema", () => {
  it("defaults to the catalog", () => {
    const parsed = listModulesQuerySchema.parse({});
    expect(parsed.scope).toBe("catalog");
    expect(parsed.page).toBe(1);
  });

  it("coerces pagination arriving as query strings", () => {
    const parsed = listModulesQuerySchema.parse({ page: "3", pageSize: "10" });
    expect(parsed).toMatchObject({ page: 3, pageSize: 10 });
  });

  it("rejects a scope it does not know", () => {
    expect(listModulesQuerySchema.safeParse({ scope: "everything" }).success).toBe(false);
  });
});
