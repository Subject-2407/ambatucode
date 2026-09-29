import { cookies } from "next/headers";
import { PageSkeleton } from "@/components/layout/page-skeleton";
import { MODULE_VIEW_COOKIE, parseModuleView } from "@/lib/module-view";

/** Shaped like the layout the Coder chose, which the cookie already says. */
export default async function Loading() {
  const view = parseModuleView((await cookies()).get(MODULE_VIEW_COOKIE)?.value);
  if (view === "grid") return <PageSkeleton variant="cards" />;
  return <PageSkeleton variant="list" width={view === "list" ? "reading" : "wide"} />;
}
