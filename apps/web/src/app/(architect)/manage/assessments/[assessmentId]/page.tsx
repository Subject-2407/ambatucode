import type { Metadata } from "next";
import { requirePageSession } from "@/lib/require-page-session";
import { AssessmentEditor } from "./assessment-editor";

export const metadata: Metadata = { title: "Assessment editor" };
export const dynamic = "force-dynamic";

type PageProps = { params: Promise<{ assessmentId: string }> };

export default async function AssessmentEditorPage({ params }: PageProps) {
  await requirePageSession("ARCHITECT");
  const { assessmentId } = await params;
  return <AssessmentEditor assessmentId={assessmentId} />;
}
