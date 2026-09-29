import { redirect } from "next/navigation";
import { routes } from "@/lib/routes";

export const dynamic = "force-dynamic";

/**
 * Achievements live on the Profile screen now, below the identity card.
 *
 * The route stays because a Coder may have bookmarked it, and because the
 * achievement toast links here. A dead URL for a screen that still exists
 * under another name is a worse answer than a redirect.
 */
export default function AchievementsPage() {
  redirect(routes.profile);
}
