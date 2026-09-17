import type { Metadata } from "next";
import { requirePageSession } from "@/lib/require-page-session";
import { GradesScreen } from "./grades-screen";

export const metadata: Metadata = { title: "Grades" };
export const dynamic = "force-dynamic";

export default async function GradesPage() {
  await requirePageSession("ARCHITECT");
  return <GradesScreen />;
}
