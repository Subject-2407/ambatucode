import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@ambatucode/db";
import {
  MAX_BLOCK_JS_BYTES,
  createPracticeRequestSchema,
  isAppError,
  type AuthenticatedUser,
  type ErrorCode,
} from "@ambatucode/shared";
import { getRedis, closeRedis } from "../redis";
import { closeQueueConnection, getRunQueue, runOwnerKey } from "../queue/producer";
import { createModule, deleteModule, getModule, listModules, updateModule } from "./modules";
import { decideEnrollment, listEnrollments, requestEnrollment } from "./enrollments";
import { createSection, deleteSection, listSections, reorderSections } from "./sections";
import { createMaterial, getMaterial, listMaterials, updateMaterial } from "./materials";
import { createPracticeActivity, runPracticeActivity } from "./practice";

/**
 * The Phase 2 flow end to end against the real database and Redis: an
 * Architect builds a Module, a Coder enrolls, reads, and runs practice code.
 *
 * What it is really guarding is the boundary. Every assertion about who cannot
 * see something matters more than the ones about who can — a leak here is
 * content a Coder was never enrolled in, or a draft the Architect had not
 * finished writing.
 */

const suffix = randomBytes(4).toString("hex");

function actor(id: string, role: AuthenticatedUser["role"], name: string): AuthenticatedUser {
  return { id, username: `${name}_${suffix}`, displayName: name, role };
}

function errorCodeOf(error: unknown): ErrorCode | null {
  return isAppError(error) ? error.code : null;
}

/** Runs the call and hands back whatever it threw, or null if it did not. */
async function captureError(call: () => Promise<unknown>): Promise<unknown> {
  try {
    await call();
    return null;
  } catch (error) {
    return error;
  }
}

/** Runs the call and reports the error code it refused with, or null. */
async function refusalCode(call: () => Promise<unknown>): Promise<ErrorCode | null> {
  try {
    await call();
    return null;
  } catch (error) {
    return errorCodeOf(error);
  }
}

let owner: AuthenticatedUser;
let otherArchitect: AuthenticatedUser;
let enrolledCoder: AuthenticatedUser;
let strangerCoder: AuthenticatedUser;
let root: AuthenticatedUser;

const createdUserIds: string[] = [];

async function makeUser(role: AuthenticatedUser["role"], name: string): Promise<AuthenticatedUser> {
  const row = await prisma.user.create({
    data: {
      username: `${name}_${suffix}`,
      // No login happens in this spec; the column simply has to be non-null.
      passwordHash: "not-a-real-hash",
      displayName: name,
      role,
    },
    select: { id: true },
  });
  createdUserIds.push(row.id);
  return actor(row.id, role, name);
}

beforeAll(async () => {
  [owner, otherArchitect, enrolledCoder, strangerCoder, root] = await Promise.all([
    makeUser("ARCHITECT", "ContentOwner"),
    makeUser("ARCHITECT", "OtherArchitect"),
    makeUser("CODER", "EnrolledCoder"),
    makeUser("CODER", "StrangerCoder"),
    makeUser("ROOT", "ContentRoot"),
  ]);
});

afterAll(async () => {
  // Modules cascade into sections, materials, practice, and enrollments.
  await prisma.module.deleteMany({ where: { ownerId: { in: createdUserIds } } });
  await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  await closeQueueConnection();
  await closeRedis();
  await prisma.$disconnect();
});

describe("module visibility", () => {
  it("keeps an unpublished module invisible to everyone but its Architect", async () => {
    const draft = await createModule(owner, {
      title: `Draft Module ${suffix}`,
      visibility: "PUBLIC",
      isPublished: false,
    });

    // The owner sees their own draft.
    await expect(getModule(owner, { id: draft.id })).resolves.toMatchObject({ id: draft.id });

    // A Coder is told it does not exist, rather than that it is forbidden:
    // the existence of a draft is not something they are entitled to infer.
    expect(await refusalCode(() => getModule(strangerCoder, { id: draft.id }))).toBe("NOT_FOUND");

    const catalog = await listModules(strangerCoder, { page: 1, pageSize: 100, scope: "catalog" });
    expect(catalog.items.map((item) => item.id)).not.toContain(draft.id);
  });

  it("refuses Root every path into learning content", async () => {
    const published = await createModule(owner, {
      title: `Root Check ${suffix}`,
      visibility: "PUBLIC",
      isPublished: true,
    });

    expect(
      await refusalCode(() => listModules(root, { page: 1, pageSize: 25, scope: "catalog" })),
    ).toBe("FORBIDDEN");
    expect(await refusalCode(() => getModule(root, { id: published.id }))).toBe("FORBIDDEN");
    expect(
      await refusalCode(() =>
        createModule(root, { title: "Root Module", visibility: "PUBLIC", isPublished: false }),
      ),
    ).toBe("FORBIDDEN");
  });

  it("lets only the owning Architect edit or delete", async () => {
    const module = await createModule(owner, {
      title: `Ownership ${suffix}`,
      visibility: "PUBLIC",
      isPublished: true,
    });

    expect(
      await refusalCode(() => updateModule(otherArchitect, module.id, { title: "Hijacked" })),
    ).toBe("FORBIDDEN");
    expect(await refusalCode(() => deleteModule(otherArchitect, module.id))).toBe("FORBIDDEN");

    await expect(updateModule(owner, module.id, { title: "Renamed" })).resolves.toMatchObject({
      title: "Renamed",
    });
  });

  it("refuses a duplicate slug instead of silently numbering it", async () => {
    const title = `Slug Clash ${suffix}`;
    await createModule(owner, { title, visibility: "PUBLIC", isPublished: false });
    expect(
      await refusalCode(() =>
        createModule(owner, { title, visibility: "PUBLIC", isPublished: false }),
      ),
    ).toBe("CONFLICT");
  });
});

describe("enrollment", () => {
  it("grants access immediately on a Public module", async () => {
    const module = await createModule(owner, {
      title: `Public Enrollment ${suffix}`,
      visibility: "PUBLIC",
      isPublished: true,
    });

    const result = await requestEnrollment(enrolledCoder, module.id);
    expect(result).toMatchObject({ status: "APPROVED", canRead: true });

    // Asking twice is not an error — a reload must not produce a conflict.
    await expect(requestEnrollment(enrolledCoder, module.id)).resolves.toMatchObject({
      status: "APPROVED",
    });
  });

  it("holds a Closed module until the Architect decides", async () => {
    const module = await createModule(owner, {
      title: `Closed Enrollment ${suffix}`,
      visibility: "CLOSED",
      isPublished: true,
    });
    const section = await createSection(owner, module.id, { title: "Locked" });
    const material = await createMaterial(owner, section.id, {
      title: "Behind approval",
      isPublished: true,
    });

    const pending = await requestEnrollment(enrolledCoder, module.id);
    expect(pending).toMatchObject({ status: "PENDING", canRead: false });

    // The module itself is visible — that is where the Enroll button lives —
    // but nothing inside it is.
    const seen = await getModule(enrolledCoder, { id: module.id });
    expect(seen.viewer).toMatchObject({ canRead: false, enrollmentStatus: "PENDING" });
    expect(seen.sections).toEqual([]);
    expect(await refusalCode(() => getMaterial(enrolledCoder, material.id))).toBe("FORBIDDEN");

    const queue = await listEnrollments(owner, module.id, {
      page: 1,
      pageSize: 25,
      status: "PENDING",
    });
    expect(queue.items).toHaveLength(1);

    await decideEnrollment(owner, module.id, queue.items[0]!.id, { status: "APPROVED" });

    const afterApproval = await getModule(enrolledCoder, { id: module.id });
    expect(afterApproval.viewer.canRead).toBe(true);
    expect(afterApproval.sections).toHaveLength(1);
    await expect(getMaterial(enrolledCoder, material.id)).resolves.toMatchObject({
      id: material.id,
    });
  });

  it("keeps the approval queue to the Architect who owns the module", async () => {
    const module = await createModule(owner, {
      title: `Queue Ownership ${suffix}`,
      visibility: "CLOSED",
      isPublished: true,
    });
    await requestEnrollment(enrolledCoder, module.id);

    expect(
      await refusalCode(() =>
        listEnrollments(otherArchitect, module.id, { page: 1, pageSize: 25 }),
      ),
    ).toBe("FORBIDDEN");
  });

  it("refuses an enrollment decision that belongs to another module", async () => {
    const [first, second] = await Promise.all([
      createModule(owner, {
        title: `Decision A ${suffix}`,
        visibility: "CLOSED",
        isPublished: true,
      }),
      createModule(owner, {
        title: `Decision B ${suffix}`,
        visibility: "CLOSED",
        isPublished: true,
      }),
    ]);
    await requestEnrollment(enrolledCoder, first.id);
    const queue = await listEnrollments(owner, first.id, { page: 1, pageSize: 25 });

    expect(
      await refusalCode(() =>
        decideEnrollment(owner, second.id, queue.items[0]!.id, { status: "APPROVED" }),
      ),
    ).toBe("NOT_FOUND");
  });
});

describe("sections and materials", () => {
  it("keeps ordering dense through reorder and delete", async () => {
    const module = await createModule(owner, {
      title: `Ordering ${suffix}`,
      visibility: "PUBLIC",
      isPublished: true,
    });

    const first = await createSection(owner, module.id, { title: "First" });
    const second = await createSection(owner, module.id, { title: "Second" });
    const third = await createSection(owner, module.id, { title: "Third" });
    expect([first.orderIndex, second.orderIndex, third.orderIndex]).toEqual([0, 1, 2]);

    const reordered = await reorderSections(owner, module.id, {
      sectionIds: [third.id, first.id, second.id],
    });
    expect(reordered.map((section) => section.title)).toEqual(["Third", "First", "Second"]);
    expect(reordered.map((section) => section.orderIndex)).toEqual([0, 1, 2]);

    // A list built from a stale tree would strand whatever it omits.
    expect(
      await refusalCode(() =>
        reorderSections(owner, module.id, { sectionIds: [third.id, first.id] }),
      ),
    ).toBe("VALIDATION_FAILED");

    await deleteSection(owner, first.id);
    const remaining = await listSections(owner, module.id);
    expect(remaining.map((section) => section.orderIndex)).toEqual([0, 1]);
  });

  it("hides an unpublished Material from the Coder and keeps it for the Architect", async () => {
    const module = await createModule(owner, {
      title: `Draft Material ${suffix}`,
      visibility: "PUBLIC",
      isPublished: true,
    });
    const section = await createSection(owner, module.id, { title: "Mixed" });
    const published = await createMaterial(owner, section.id, {
      title: "Ready to read",
      isPublished: true,
    });
    const draft = await createMaterial(owner, section.id, {
      title: "Still writing",
      isPublished: false,
    });

    await requestEnrollment(enrolledCoder, module.id);

    const coderView = await listMaterials(enrolledCoder, section.id);
    expect(coderView.map((material) => material.id)).toEqual([published.id]);
    expect(await refusalCode(() => getMaterial(enrolledCoder, draft.id))).toBe("NOT_FOUND");

    const ownerView = await listMaterials(owner, section.id);
    expect(ownerView).toHaveLength(2);

    const tree = await getModule(enrolledCoder, { id: module.id });
    expect(tree.sections[0]?.materials.map((material) => material.id)).toEqual([published.id]);
  });

  it("stores and returns the rich text document unchanged", async () => {
    const module = await createModule(owner, {
      title: `Rich Text ${suffix}`,
      visibility: "PUBLIC",
      isPublished: true,
    });
    const section = await createSection(owner, module.id, { title: "Reading" });
    const document = {
      type: "doc" as const,
      content: [
        { type: "paragraph", content: [{ type: "text", text: "Read this first." }] },
        { type: "horizontalRule" },
      ],
    };

    const material = await createMaterial(owner, section.id, {
      title: "With content",
      content: document,
      isPublished: true,
    });

    const stored = await getMaterial(owner, material.id);
    expect(stored.content).toEqual(document);
  });
});

describe("interactive blocks", () => {
  /** A published module the Coder is enrolled in, with one empty Material. */
  async function buildMaterial(title: string) {
    const module = await createModule(owner, {
      title: `${title} ${suffix}`,
      visibility: "PUBLIC",
      isPublished: true,
    });
    const section = await createSection(owner, module.id, { title: "Reading" });
    await requestEnrollment(enrolledCoder, module.id);
    return createMaterial(owner, section.id, { title, isPublished: true });
  }

  function block(id: string, overrides: Record<string, unknown> = {}) {
    return {
      type: "interactiveBlock",
      attrs: {
        id,
        title: "Binary search",
        html: '<div id="stage"></div>',
        css: "#stage { color: red }",
        js: "document.getElementById('stage').textContent = 'ready'",
        initialHeight: 240,
        ...overrides,
      },
    };
  }

  it("round-trips a material holding several blocks, byte for byte", async () => {
    const material = await buildMaterial("Blocks round trip");
    const document = {
      type: "doc" as const,
      content: [
        { type: "paragraph", content: [{ type: "text", text: "Watch it run:" }] },
        block("first"),
        { type: "paragraph", content: [{ type: "text", text: "And again:" }] },
        block("second", { title: "Second pass" }),
      ],
    };

    await updateMaterial(owner, material.id, { content: document });

    // Nothing is sanitized, stripped, or rewritten on either leg. Safety comes
    // from where the content runs — an opaque-origin sandboxed frame — not
    // from filtering it on the way past, and a filter here would quietly break
    // legitimate authoring while providing assurance it cannot deliver.
    expect((await getMaterial(owner, material.id)).content).toEqual(document);
    expect((await getMaterial(enrolledCoder, material.id)).content).toEqual(document);
  });

  it("refuses an oversized block and names which one to trim", async () => {
    const material = await buildMaterial("Oversized block");
    const tooMuch = "a".repeat(MAX_BLOCK_JS_BYTES + 1);

    const refusal = await captureError(() =>
      updateMaterial(owner, material.id, {
        content: { type: "doc", content: [block("fine"), block("fat", { js: tooMuch })] },
      }),
    );

    expect(errorCodeOf(refusal)).toBe("VALIDATION_FAILED");
    // "Content is invalid" would send an Architect hunting through twenty
    // blocks. Naming the offending one is the whole point of the message.
    expect((refusal as Error).message).toContain("block fat");
    expect((refusal as Error).message).not.toContain("block fine");
  });

  it("counts the limit in bytes, so multi-byte content cannot slip past it", async () => {
    const material = await buildMaterial("Multibyte block");
    // A quarter of the character budget and four times the bytes. A
    // `String.length` check would wave this straight through.
    const emoji = "🙂".repeat(MAX_BLOCK_JS_BYTES / 4 + 1);

    expect(emoji.length).toBeLessThan(MAX_BLOCK_JS_BYTES);
    expect(
      await refusalCode(() =>
        updateMaterial(owner, material.id, {
          content: { type: "doc", content: [block("emoji", { js: emoji })] },
        }),
      ),
    ).toBe("VALIDATION_FAILED");
  });

  it("refuses malformed attrs rather than storing a block nothing can render", async () => {
    const material = await buildMaterial("Malformed block");

    expect(
      await refusalCode(() =>
        updateMaterial(owner, material.id, {
          content: { type: "doc", content: [block("weird", { js: 42 })] },
        }),
      ),
    ).toBe("VALIDATION_FAILED");

    expect(
      await refusalCode(() =>
        updateMaterial(owner, material.id, {
          content: { type: "doc", content: [{ type: "interactiveBlock", attrs: {} }] },
        }),
      ),
    ).toBe("VALIDATION_FAILED");
  });

  it("fails loudly when a stored document holds a drifted block, rather than serving it", async () => {
    const material = await buildMaterial("Drifted block");

    // Written straight past the service, the way an older editor build would
    // have. The open node schema accepts it — attrs are untyped by design — so
    // the check on the read leg is the only thing between a drifted shape and
    // a document that executes in a reader's browser.
    await prisma.material.update({
      where: { id: material.id },
      data: {
        contentJson: {
          type: "doc",
          content: [{ type: "interactiveBlock", attrs: { id: "legacy", markup: "<p>old</p>" } }],
        },
      },
    });

    expect(await refusalCode(() => getMaterial(owner, material.id))).toBe("INTERNAL");
    expect(await refusalCode(() => getMaterial(enrolledCoder, material.id))).toBe("INTERNAL");
  });

  it("keeps blocks out of a practice prompt, which is prose and not a document", () => {
    // The prompt is a plain string, so there is no node for a block to be, and
    // the assertion is that it stays that way. A document here would put an
    // Architect-authored program inside the timed workspace, where anti-cheat
    // and timing controls are active and there is no frame host.
    expect(
      createPracticeRequestSchema.safeParse({
        title: "Smuggled",
        prompt: { type: "doc", content: [block("sneaky")] },
        allowedLanguages: ["python"],
        testCases: [{ name: "one", input: "", expectedOutput: "" }],
      }).success,
    ).toBe(false);
  });
});

describe("practice", () => {
  async function buildActivity(title: string) {
    const module = await createModule(owner, {
      title: `${title} ${suffix}`,
      visibility: "PUBLIC",
      isPublished: true,
    });
    const section = await createSection(owner, module.id, { title: "Practice" });
    const material = await createMaterial(owner, section.id, {
      title: "With practice",
      isPublished: true,
    });
    const activity = await createPracticeActivity(owner, material.id, {
      title: "Greet the caller",
      prompt: "Print a greeting.",
      allowedLanguages: ["python"],
      starterCode: { python: "name = input()\n" },
      timeLimitMs: 5_000,
      memoryLimitMb: 256,
      testCases: [
        {
          name: "Ordinary name",
          input: "Ada\n",
          expectedOutput: "Hello, Ada!",
          comparison: "TRIMMED",
        },
      ],
    });
    return { module, material, activity };
  }

  it("refuses to author an activity in a language nothing can execute", async () => {
    const module = await createModule(owner, {
      title: `Unrunnable ${suffix}`,
      visibility: "PUBLIC",
      isPublished: true,
    });
    const section = await createSection(owner, module.id, { title: "Practice" });
    const material = await createMaterial(owner, section.id, { title: "Java", isPublished: true });

    // Caught while the Architect is authoring, not as a SYSTEM_ERROR a Coder
    // meets halfway through the exercise.
    expect(
      await refusalCode(() =>
        createPracticeActivity(owner, material.id, {
          title: "Java practice",
          prompt: "Print a greeting.",
          allowedLanguages: ["java"],
          starterCode: {},
          timeLimitMs: 5_000,
          memoryLimitMb: 256,
          testCases: [{ name: "One", input: "", expectedOutput: "", comparison: "TRIMMED" }],
        }),
      ),
    ).toBe("LANGUAGE_NOT_ALLOWED");
  });

  it("gives every case a stable id so the editor can track it", async () => {
    const { activity } = await buildActivity("Case Ids");
    expect(activity.testCases[0]?.id).toBeTruthy();
  });

  it("enqueues a Run carrying only public cases, and never writes a Submission", async () => {
    const { module, activity } = await buildActivity("Run Path");
    await requestEnrollment(enrolledCoder, module.id);

    const { jobId } = await runPracticeActivity(enrolledCoder, activity.id, {
      language: "python",
      sourceCode: 'name = input()\nprint(f"Hello, {name}!")\n',
    });

    const job = await getRunQueue().getJob(jobId);
    expect(job?.data.kind).toBe("RUN");
    expect(job?.data.submissionId).toBeNull();
    expect(job?.data.testCases.every((testCase) => testCase.isPublic)).toBe(true);
    expect(job?.data.testScript).toBeNull();

    // The owner record is the only thing that says who the result belongs to.
    expect(await getRedis().get(runOwnerKey(jobId))).toBe(enrolledCoder.id);

    // A Run is not a Submission and must leave no grading history behind.
    expect(await prisma.submission.count({ where: { userId: enrolledCoder.id } })).toBe(0);
  });

  it("refuses a language the activity does not allow", async () => {
    const { activity } = await buildActivity("Language Guard");
    expect(
      await refusalCode(() =>
        runPracticeActivity(owner, activity.id, { language: "javascript", sourceCode: "" }),
      ),
    ).toBe("LANGUAGE_NOT_ALLOWED");
  });

  it("refuses a Run from a Coder who never enrolled", async () => {
    const { activity } = await buildActivity("Stranger Run");
    expect(
      await refusalCode(() =>
        runPracticeActivity(strangerCoder, activity.id, { language: "python", sourceCode: "" }),
      ),
    ).toBe("FORBIDDEN");
  });

  it("rate-limits runs per Coder per activity", async () => {
    const { activity } = await buildActivity("Rate Limit");

    // Pre-fill the window rather than issuing thirty containers' worth of work.
    const key = `ratelimit:practice-run:${owner.id}:${activity.id}`;
    await getRedis().set(key, "30", "EX", 60);

    expect(
      await refusalCode(() =>
        runPracticeActivity(owner, activity.id, { language: "python", sourceCode: "" }),
      ),
    ).toBe("RATE_LIMITED");

    await getRedis().del(key);
  });
});
