import type { Metadata } from "next";
import { z } from "zod";
import { requirePageSession } from "@/lib/require-page-session";
import { BuilderScreen } from "./builder-screen";

export const metadata: Metadata = { title: "Module builder" };
export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ moduleId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

/**
 * `?section=` names the Section to open, so a link back from an Assessment
 * lands beside it rather than at the top of the tree. It is a preference, not
 * an address: an id the Module does not hold falls back to the first Section,
 * and anything malformed is dropped here rather than reaching the screen.
 */
const builderSearchSchema = z.object({
  section: z.string().trim().min(1).max(64).optional().catch(undefined),
});

export default async function ModuleBuilderPage({ params, searchParams }: PageProps) {
  await requirePageSession("ARCHITECT");
  const { moduleId } = await params;
  const { section } = builderSearchSchema.parse(await searchParams);
  return <BuilderScreen moduleId={moduleId} initialSectionId={section ?? null} />;
}
