import type { Metadata } from "next";
import { requirePageSession } from "@/lib/require-page-session";
import { SubmissionsScreen } from "./submissions-screen";

export const metadata: Metadata = { title: "Submissions" };
export const dynamic = "force-dynamic";

export default async function SubmissionsPage() {
  await requirePageSession("CODER");
  return <SubmissionsScreen />;
}
