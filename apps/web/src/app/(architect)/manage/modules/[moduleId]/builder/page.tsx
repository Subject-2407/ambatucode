import type { Metadata } from "next";
import { requirePageSession } from "@/lib/require-page-session";
import { BuilderScreen } from "./builder-screen";

export const metadata: Metadata = { title: "Module builder" };
export const dynamic = "force-dynamic";

type PageProps = { params: Promise<{ moduleId: string }> };

export default async function ModuleBuilderPage({ params }: PageProps) {
  await requirePageSession("ARCHITECT");
  const { moduleId } = await params;
  return <BuilderScreen moduleId={moduleId} />;
}
