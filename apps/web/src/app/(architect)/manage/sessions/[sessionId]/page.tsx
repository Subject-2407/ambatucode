import type { Metadata } from "next";
import { requirePageSession } from "@/lib/require-page-session";
import { SessionScreen } from "./session-screen";

export const metadata: Metadata = { title: "Assessment session" };
export const dynamic = "force-dynamic";

type PageProps = { params: Promise<{ sessionId: string }> };

export default async function SessionPage({ params }: PageProps) {
  await requirePageSession("ARCHITECT");
  const { sessionId } = await params;
  return <SessionScreen sessionId={sessionId} />;
}
