import type { Metadata } from "next";
import { requirePageSession } from "@/lib/require-page-session";
import { MonitorScreen } from "./monitor-screen";

export const metadata: Metadata = { title: "Live monitoring" };
export const dynamic = "force-dynamic";

type PageProps = { params: Promise<{ sessionId: string }> };

export default async function MonitorPage({ params }: PageProps) {
  await requirePageSession("ARCHITECT");
  const { sessionId } = await params;
  return <MonitorScreen sessionId={sessionId} />;
}
