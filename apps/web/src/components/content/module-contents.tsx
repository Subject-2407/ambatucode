import NextLink from "next/link";
import { Box, HStack, Stack, Text } from "@chakra-ui/react";
import { ClipboardCheck, FileText } from "lucide-react";
import type { ModuleDetail, ModuleItemKind } from "@ambatucode/shared";
import { routes } from "@/lib/routes";
import { sectionNumberLabel } from "@/lib/section-label";
import { PIXEL } from "@/theme/pixel";

/**
 * The Module's contents beside a Material, with the Coder's place in it marked.
 *
 * The back button returns to the overview; this saves the trip. A Coder who
 * wants the Material two Sections back, or a look at what the Assessment at
 * the end is called, can go straight there from the page they are reading.
 *
 * Wide screens only. Below that it would push the reading column into half a
 * phone, and the back button is one tap away.
 */
export function ModuleContents({
  module,
  current,
}: {
  module: ModuleDetail;
  current: { kind: ModuleItemKind; id: string };
}) {
  return (
    <Box
      as="nav"
      aria-label="Module contents"
      display={{ base: "none", xl: "block" }}
      position="sticky"
      top="8"
      // Its own scroll, so a long Module never pushes the page taller than the
      // Material it sits beside.
      maxHeight="calc(100dvh - 4rem)"
      overflowY="auto"
      paddingEnd="2"
    >
      <Stack gap="5">
        <Text textStyle="display" fontSize="2xs" color="fg.muted">
          Contents
        </Text>
        {module.sections.map((section, index) => (
          <Stack key={section.id} gap="1">
            <HStack gap="2" align="baseline" mb="1">
              <Text textStyle="display" fontSize="3xs" color="accent.fg">
                {sectionNumberLabel(index + 1)}
              </Text>
              <Text textStyle="display" fontSize="3xs" color="fg.muted">
                {section.title}
              </Text>
            </HStack>
            {section.materials.map((material) => (
              <ContentsLink
                key={material.id}
                href={routes.material(module.slug, material.id)}
                title={material.title}
                icon={<FileText size={14} aria-hidden />}
                active={current.kind === "MATERIAL" && current.id === material.id}
              />
            ))}
            {section.assessments.map((assessment) => (
              <ContentsLink
                key={assessment.id}
                href={routes.assessment(module.slug, assessment.id)}
                title={assessment.title}
                icon={<ClipboardCheck size={14} aria-hidden />}
                active={current.kind === "ASSESSMENT" && current.id === assessment.id}
                assessment
              />
            ))}
          </Stack>
        ))}
      </Stack>
    </Box>
  );
}

/**
 * One entry. The current one is marked by a filled tab on its leading edge as
 * well as its fill, the same pair the navigation rail uses, so the mark does
 * not rest on colour alone.
 */
function ContentsLink({
  href,
  title,
  icon,
  active,
  assessment = false,
}: {
  href: string;
  title: string;
  icon: React.ReactNode;
  active: boolean;
  assessment?: boolean;
}) {
  return (
    <Box
      asChild
      display="block"
      position="relative"
      paddingY="1.5"
      paddingStart="3"
      paddingEnd="2"
      fontSize="sm"
      color={active ? "fg.default" : assessment ? "fg.info" : "fg.muted"}
      bg={active ? "accent.subtle" : undefined}
      fontWeight={active ? "medium" : undefined}
      _hover={active ? undefined : { color: "fg.default", bg: "bg.subtle" }}
      _before={
        active
          ? {
              content: '""',
              position: "absolute",
              insetStart: "0",
              top: "0",
              bottom: "0",
              width: `${PIXEL}px`,
              bg: "accent.solid",
            }
          : undefined
      }
    >
      <NextLink href={href} aria-current={active ? "page" : undefined}>
        <HStack gap="2" minWidth="0">
          <Box flexShrink="0">{icon}</Box>
          <Text truncate>{title}</Text>
        </HStack>
      </NextLink>
    </Box>
  );
}
