import type { Metadata } from "next";
import { parseGradeFilters, type SearchParamsRecord } from "@/components/grades/grade-filters";
import { requirePageSession } from "@/lib/require-page-session";
import { GradesScreen } from "./grades-screen";

export const metadata: Metadata = { title: "Grades" };
export const dynamic = "force-dynamic";

type PageProps = { searchParams: Promise<SearchParamsRecord> };

/**
 * The filters arrive in the URL so a filtered view can be linked and survives a
 * reload. They are parsed here, once, and handed down as plain data; the screen
 * keeps the URL in step from then on without asking the server again.
 */
export default async function GradesPage({ searchParams }: PageProps) {
  await requirePageSession("ARCHITECT");
  return <GradesScreen initialFilters={parseGradeFilters(await searchParams)} />;
}
