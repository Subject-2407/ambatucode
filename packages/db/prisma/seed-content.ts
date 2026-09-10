import type { PrismaClient } from "@prisma/client";

/**
 * Demo learning content.
 *
 * Every row carries a fixed `seed-` id so a re-seed updates what it created
 * last time instead of stacking a second copy beside it, and so a developer can
 * link to a known Module without looking one up.
 *
 * The shapes here are the same ones the API validates: a rich text document as
 * the editor stores it, and practice cases with ids, because an activity whose
 * cases have no ids is one the editor cannot track across an edit.
 */

const PYTHON_MODULE_ID = "seed-module-python";
const ALGORITHM_MODULE_ID = "seed-module-algorithms";

type SeedUsers = { architect1: string; architect2: string; coderIds: string[] };

const helloDocument = {
  type: "doc",
  content: [
    {
      type: "heading",
      attrs: { level: 2 },
      content: [{ type: "text", text: "Reading input" }],
    },
    {
      type: "paragraph",
      content: [
        { type: "text", text: "A program talks to the grader through " },
        { type: "text", marks: [{ type: "code" }], text: "stdin" },
        { type: "text", text: " and " },
        { type: "text", marks: [{ type: "code" }], text: "stdout" },
        {
          type: "text",
          text: ". Read a line, do something with it, print the answer — that is the whole contract.",
        },
      ],
    },
    {
      type: "codeBlock",
      attrs: { language: "python" },
      content: [{ type: "text", text: 'name = input()\nprint(f"Hello, {name}!")' }],
    },
    {
      type: "paragraph",
      content: [
        { type: "text", marks: [{ type: "bold" }], text: "Try it below." },
        { type: "text", text: " Practice runs are unlimited and are never graded." },
      ],
    },
  ],
};

const loopsDocument = {
  type: "doc",
  content: [
    {
      type: "heading",
      attrs: { level: 2 },
      content: [{ type: "text", text: "Repeating work" }],
    },
    {
      type: "paragraph",
      content: [
        {
          type: "text",
          text: "A loop turns one instruction into many. Read how many numbers are coming, then read that many lines.",
        },
      ],
    },
    {
      type: "bulletList",
      content: [
        {
          type: "listItem",
          content: [
            { type: "paragraph", content: [{ type: "text", text: "Read the count first." }] },
          ],
        },
        {
          type: "listItem",
          content: [
            {
              type: "paragraph",
              content: [{ type: "text", text: "Accumulate as you read, not afterwards." }],
            },
          ],
        },
      ],
    },
  ],
};

const binarySearchDocument = {
  type: "doc",
  content: [
    {
      type: "paragraph",
      content: [
        {
          type: "text",
          text: "Closed modules need the Architect to approve an enrollment before any of this is readable.",
        },
      ],
    },
  ],
};

export async function seedContent(prisma: PrismaClient, users: SeedUsers): Promise<void> {
  await prisma.module.upsert({
    where: { id: PYTHON_MODULE_ID },
    create: {
      id: PYTHON_MODULE_ID,
      title: "Python Foundations",
      slug: "python-foundations",
      description: "Input, output, and the loops in between.",
      visibility: "PUBLIC",
      isPublished: true,
      ownerId: users.architect1,
    },
    update: { ownerId: users.architect1, isPublished: true },
  });

  await prisma.module.upsert({
    where: { id: ALGORITHM_MODULE_ID },
    create: {
      id: ALGORITHM_MODULE_ID,
      title: "Algorithm Lab",
      slug: "algorithm-lab",
      description: "Closed module — enrollment needs Architect approval.",
      visibility: "CLOSED",
      isPublished: true,
      ownerId: users.architect2,
    },
    update: { ownerId: users.architect2, isPublished: true },
  });

  const sections = [
    { id: "seed-section-basics", moduleId: PYTHON_MODULE_ID, title: "Getting Started", order: 0 },
    { id: "seed-section-loops", moduleId: PYTHON_MODULE_ID, title: "Control Flow", order: 1 },
    { id: "seed-section-search", moduleId: ALGORITHM_MODULE_ID, title: "Searching", order: 0 },
  ];

  for (const section of sections) {
    await prisma.section.upsert({
      where: { id: section.id },
      create: {
        id: section.id,
        moduleId: section.moduleId,
        title: section.title,
        orderIndex: section.order,
      },
      update: { title: section.title, orderIndex: section.order },
    });
  }

  const materials = [
    {
      id: "seed-material-hello",
      sectionId: "seed-section-basics",
      title: "Hello, Ambatucode",
      order: 0,
      contentJson: helloDocument,
      isPublished: true,
    },
    {
      id: "seed-material-loops",
      sectionId: "seed-section-loops",
      title: "Loops and Sums",
      order: 0,
      contentJson: loopsDocument,
      isPublished: true,
    },
    {
      // Deliberately unpublished: the Architect sees it in the builder, a Coder
      // must not see it at all. Worth having in the seed so that rule is
      // exercised by hand as well as by tests.
      id: "seed-material-draft",
      sectionId: "seed-section-loops",
      title: "While Loops (draft)",
      order: 1,
      contentJson: { type: "doc", content: [] },
      isPublished: false,
    },
    {
      id: "seed-material-binary-search",
      sectionId: "seed-section-search",
      title: "Binary Search",
      order: 0,
      contentJson: binarySearchDocument,
      isPublished: true,
    },
  ];

  for (const material of materials) {
    await prisma.material.upsert({
      where: { id: material.id },
      create: {
        id: material.id,
        sectionId: material.sectionId,
        title: material.title,
        orderIndex: material.order,
        contentJson: material.contentJson,
        isPublished: material.isPublished,
      },
      update: {
        title: material.title,
        orderIndex: material.order,
        contentJson: material.contentJson,
        isPublished: material.isPublished,
      },
    });
  }
}

const practiceActivities = [
  {
    id: "seed-practice-greeting",
    materialId: "seed-material-hello",
    title: "Greet the caller",
    order: 0,
    prompt: "Read one line from standard input and print `Hello, <name>!`.",
    // Python alone: it is the only language with a built sandbox image today,
    // and offering one the worker cannot run would fail at the worst moment.
    allowedLanguages: ["python"],
    starterCodeJson: { python: "name = input()\n# print the greeting here\n" },
    testCasesJson: [
      {
        id: "seed-case-greeting-1",
        name: "Ordinary name",
        input: "Ada\n",
        expectedOutput: "Hello, Ada!",
        comparison: "TRIMMED",
      },
      {
        id: "seed-case-greeting-2",
        name: "Name with a space",
        input: "Grace Hopper\n",
        expectedOutput: "Hello, Grace Hopper!",
        comparison: "TRIMMED",
      },
    ],
  },
  {
    id: "seed-practice-sum",
    materialId: "seed-material-loops",
    title: "Sum the numbers",
    order: 0,
    prompt: "The first line holds a count. Read that many integers and print their sum.",
    allowedLanguages: ["python"],
    starterCodeJson: { python: "count = int(input())\ntotal = 0\n# read and accumulate\n" },
    testCasesJson: [
      {
        id: "seed-case-sum-1",
        name: "Three numbers",
        input: "3\n1\n2\n3\n",
        expectedOutput: "6",
        comparison: "TRIMMED",
      },
      {
        id: "seed-case-sum-2",
        name: "Nothing to add",
        input: "0\n",
        expectedOutput: "0",
        comparison: "TRIMMED",
      },
    ],
  },
];

export async function seedPractice(prisma: PrismaClient): Promise<void> {
  for (const activity of practiceActivities) {
    await prisma.practiceActivity.upsert({
      where: { id: activity.id },
      create: {
        id: activity.id,
        materialId: activity.materialId,
        title: activity.title,
        orderIndex: activity.order,
        prompt: activity.prompt,
        allowedLanguages: activity.allowedLanguages,
        starterCodeJson: activity.starterCodeJson,
        testCasesJson: activity.testCasesJson,
      },
      update: {
        title: activity.title,
        orderIndex: activity.order,
        prompt: activity.prompt,
        allowedLanguages: activity.allowedLanguages,
        starterCodeJson: activity.starterCodeJson,
        testCasesJson: activity.testCasesJson,
      },
    });
  }
}

/**
 * Enrollments covering all three states, so the Architect's approval queue has
 * something in it and a Coder can see what pending access looks like without
 * anyone clicking through the flow first.
 */
export async function seedEnrollments(prisma: PrismaClient, users: SeedUsers): Promise<void> {
  const [first, second, third, fourth, fifth, sixth, seventh, eighth] = users.coderIds;

  const approvedInPython = [first, second, third, fourth, fifth].filter(
    (id): id is string => id !== undefined,
  );

  for (const userId of approvedInPython) {
    await prisma.moduleEnrollment.upsert({
      where: { moduleId_userId: { moduleId: PYTHON_MODULE_ID, userId } },
      // A Public module grants access on request, so nobody decided this.
      create: { moduleId: PYTHON_MODULE_ID, userId, status: "APPROVED", decidedAt: new Date() },
      update: { status: "APPROVED" },
    });
  }

  const closedStates = [
    { userId: sixth, status: "PENDING" as const, decider: null },
    { userId: seventh, status: "APPROVED" as const, decider: users.architect2 },
    { userId: eighth, status: "REJECTED" as const, decider: users.architect2 },
  ];

  for (const entry of closedStates) {
    if (!entry.userId) continue;
    const decided = entry.decider
      ? { decidedById: entry.decider, decidedAt: new Date() }
      : { decidedById: null, decidedAt: null };

    await prisma.moduleEnrollment.upsert({
      where: { moduleId_userId: { moduleId: ALGORITHM_MODULE_ID, userId: entry.userId } },
      create: {
        moduleId: ALGORITHM_MODULE_ID,
        userId: entry.userId,
        status: entry.status,
        ...decided,
      },
      update: { status: entry.status, ...decided },
    });
  }
}
