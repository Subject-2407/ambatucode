import { Box, Grid, Stack } from "@chakra-ui/react";
import { Skeleton } from "@/components/ui/skeleton";
import { PageContainer, type PageWidth } from "./app-shell";

/**
 * What a Coder sees between clicking and the server answering.
 *
 * Every Coder page is rendered on the server and none of them had a loading
 * state, so a click on a Module or a Material did nothing visible until the
 * whole next page had arrived — long enough on a lab network to click again.
 * These are shaped like the page that is coming, and sit in the same centred
 * column, so the content lands where the placeholder already was instead of
 * the layout jumping.
 */

export type PageSkeletonVariant =
  /** A header and a grid of cards: dashboard, catalog, a Module as a grid. */
  | "cards"
  /** A header and a column of rows: a Module's sections, a table. */
  | "list"
  /** A back link, a title, and paragraphs: a Material, a submission. */
  | "reading"
  /** A back link, the problem on the left, the ways in on the right. */
  | "split";

function Bar({ width, height = "4" }: { width: string; height?: string }) {
  return <Skeleton height={height} width={width} borderRadius="0" />;
}

export function PageSkeleton({
  variant,
  width = "wide",
}: {
  variant: PageSkeletonVariant;
  /** The measure of the page that is coming, so the placeholder lines up with it. */
  width?: PageWidth;
}) {
  const hasBack = variant === "reading" || variant === "split";

  return (
    <PageContainer width={width}>
      <Stack gap="6" aria-busy="true" aria-label="Loading">
        <Stack gap="3">
          {hasBack ? <Bar width="9rem" height="6" /> : null}
          <Bar width="min(24rem, 70%)" height="8" />
        </Stack>

        {variant === "cards" ? (
          <Grid
            templateColumns={{ base: "1fr", md: "repeat(2, 1fr)", xl: "repeat(3, 1fr)" }}
            gap="4"
          >
            {Array.from({ length: 6 }, (_, index) => (
              <Skeleton key={index} height="8rem" borderRadius="0" />
            ))}
          </Grid>
        ) : null}

        {variant === "list" ? (
          <Stack gap="2">
            {Array.from({ length: 6 }, (_, index) => (
              <Skeleton key={index} height="3rem" borderRadius="0" />
            ))}
          </Stack>
        ) : null}

        {variant === "reading" ? (
          <Stack gap="3">
            {["100%", "96%", "88%", "100%", "72%", "92%", "60%"].map((width, index) => (
              <Bar key={index} width={width} />
            ))}
          </Stack>
        ) : null}

        {variant === "split" ? (
          <Grid templateColumns={{ base: "1fr", lg: "minmax(0, 1.4fr) minmax(0, 1fr)" }} gap="6">
            <Skeleton height="24rem" borderRadius="0" />
            <Box>
              <Stack gap="4">
                <Skeleton height="8rem" borderRadius="0" />
                <Skeleton height="10rem" borderRadius="0" />
              </Stack>
            </Box>
          </Grid>
        ) : null}
      </Stack>
    </PageContainer>
  );
}
