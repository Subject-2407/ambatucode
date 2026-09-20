import NextLink from "next/link";
import { HStack, Stack, Text } from "@chakra-ui/react";
import { ArrowRight, ClipboardCheck, FileText, Flag } from "lucide-react";
import type { NextModuleItem } from "@ambatucode/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PixelFrame } from "@/components/ui/pixel-frame";
import { routes } from "@/lib/routes";

/**
 * The way on, at the foot of a Material or an Assessment.
 *
 * It names what is next rather than saying only "Next", because the next thing
 * may be an exam. Walking from an explanation straight into a graded
 * Assessment by clicking a button labelled with an arrow is not a step anybody
 * should take unknowingly, so the kind is spelled out and an Assessment is
 * marked as one.
 *
 * At the end of the Module it becomes the way back to the overview. A dead
 * button, or none at all, leaves the reader to work out for themselves that
 * they have finished.
 */
export function NextItemLink({ progression }: { progression: NextModuleItem }) {
  const { moduleSlug, next } = progression;

  if (next === null) {
    return (
      <PixelFrame tone="muted" pad="4">
        <HStack justify="space-between" gap="3" wrap="wrap">
          <HStack gap="3" minWidth="0">
            <Flag size={16} aria-hidden />
            <Text fontSize="sm" color="fg.muted">
              That is the end of this module.
            </Text>
          </HStack>
          <Button asChild variant="outline" size="sm">
            <NextLink href={routes.module(moduleSlug)}>Back to module</NextLink>
          </Button>
        </HStack>
      </PixelFrame>
    );
  }

  const isAssessment = next.kind === "ASSESSMENT";
  const href = isAssessment
    ? routes.assessment(moduleSlug, next.id)
    : routes.material(moduleSlug, next.id);

  return (
    <PixelFrame tone={isAssessment ? "danger" : "accent"} pad="4">
      <HStack justify="space-between" gap="4" wrap="wrap">
        <Stack gap="1" minWidth="0">
          <Text textStyle="display" fontSize="2xs" color="fg.muted">
            Next · {next.sectionTitle}
          </Text>
          <HStack gap="2" minWidth="0">
            {isAssessment ? (
              <ClipboardCheck size={16} aria-hidden />
            ) : (
              <FileText size={16} aria-hidden />
            )}
            <Text truncate>{next.title}</Text>
            {isAssessment ? <Badge tone="danger">Assessment</Badge> : null}
          </HStack>
        </Stack>

        <Button asChild size="sm">
          <NextLink href={href}>
            Next
            <ArrowRight aria-hidden />
          </NextLink>
        </Button>
      </HStack>
    </PixelFrame>
  );
}
