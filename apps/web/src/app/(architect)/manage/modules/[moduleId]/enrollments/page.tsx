import type { Metadata } from "next";
import { requirePageSession } from "@/lib/require-page-session";
import { EnrollmentsScreen } from "./enrollments-screen";

export const metadata: Metadata = { title: "Enrollments" };
export const dynamic = "force-dynamic";

type PageProps = { params: Promise<{ moduleId: string }> };

export default async function EnrollmentsPage({ params }: PageProps) {
  await requirePageSession("ARCHITECT");
  const { moduleId } = await params;
  return <EnrollmentsScreen moduleId={moduleId} />;
}
