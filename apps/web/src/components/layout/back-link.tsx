import NextLink from "next/link";
import { ChevronLeft } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * The way back up, above a page's title.
 *
 * A breadcrumb trail stood here for a while. Every Coder page is one level
 * below the thing it came from, so the trail was only ever one link long and
 * said the same as this button in more space. Where the page sits within its
 * parent is the header's kicker now, not a second row of navigation.
 *
 * Ghost, so it is plainly not the page's primary action, and pulled left by
 * its own padding so the chevron lines up with the title under it.
 */
export function BackLink({ href, label }: { href: string; label: string }) {
  return (
    <Button asChild variant="ghost" size="sm" color="fg.muted" ms="-3.5" mb="3">
      <NextLink href={href}>
        <ChevronLeft aria-hidden />
        {label}
      </NextLink>
    </Button>
  );
}
