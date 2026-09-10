import type { Metadata } from "next";
import NextLink from "next/link";
import { Box, Flex, HStack, Stack, Text } from "@chakra-ui/react";
import { ChevronRight, FileText, Lock, Terminal } from "lucide-react";
import type { ModuleDetail, ModuleSectionView } from "@ambatucode/shared";
import { PageContainer, PageHeader } from "@/components/layout/app-shell";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { handlePageError } from "@/lib/page-errors";
import { requirePageSession } from "@/lib/require-page-session";
import { routes } from "@/lib/routes";
import { getModule } from "@/server/services/modules";
import { EnrollButton } from "../enroll-button";

export const metadata: Metadata = { title: "Module" };
export const dynamic = "force-dynamic";

type PageProps = { params: Promise<{ moduleSlug: string }> };

/**
 * The Module a Coder opens.
 *
 * Fetched in the Server Component rather than through the API client: this is
 * the first paint of the page, and a loopback HTTP request to our own route
 * handler would only add a round trip and a cookie to forward.
 */
export default async function ModuleOverviewPage({ params }: PageProps) {
  const session = await requirePageSession("CODER");
  const { moduleSlug } = await params;

  const module = await getModule(session.user, { slug: moduleSlug }).catch((error: unknown) =>
    handlePageError(error),
  );

  return (
    <PageContainer>
      <PageHeader
        title={module.title}
        description={module.description ?? undefined}
        action={
          module.visibility === "CLOSED" ? (
            <Badge tone="warning">
              <Lock size={12} aria-hidden /> Closed
            </Badge>
          ) : (
            <Badge>Public</Badge>
          )
        }
      />

      {module.viewer.canRead ? <SectionTree module={module} /> : <AccessPanel module={module} />}
    </PageContainer>
  );
}

/**
 * What a Coder sees before they belong to the module. The tree is absent
 * because the server did not send it, not because it was filtered here.
 */
function AccessPanel({ module }: { module: ModuleDetail }) {
  const pending = module.viewer.enrollmentStatus === "PENDING";

  return (
    <EmptyState
      icon={<Lock aria-hidden />}
      title={pending ? "Waiting for approval" : "Enroll to read this module"}
      description={
        pending
          ? "The Architect has your request. The materials open as soon as it is approved."
          : module.visibility === "CLOSED"
            ? "This is a Closed module, so the Architect approves each request."
            : "Enrolling is immediate on a Public module."
      }
      action={<EnrollButton module={module} />}
    />
  );
}

function SectionTree({ module }: { module: ModuleDetail }) {
  if (module.sections.length === 0) {
    return (
      <EmptyState
        icon={<FileText aria-hidden />}
        title="Nothing published yet"
        description="The Architect has not added any sections to this module."
      />
    );
  }

  return (
    <Stack gap="6">
      {module.sections.map((section, index) => (
        <SectionBlock key={section.id} section={section} index={index} moduleSlug={module.slug} />
      ))}
    </Stack>
  );
}

function SectionBlock({
  section,
  index,
  moduleSlug,
}: {
  section: ModuleSectionView;
  index: number;
  moduleSlug: string;
}) {
  return (
    <Stack gap="3">
      <HStack gap="3" align="baseline">
        <Text fontSize="xs" color="fg.muted" fontWeight="medium">
          {String(index + 1).padStart(2, "0")}
        </Text>
        <Text fontWeight="semibold">{section.title}</Text>
      </HStack>

      {section.materials.length === 0 ? (
        <Text fontSize="sm" color="fg.muted" ps="8">
          No materials in this section yet.
        </Text>
      ) : (
        <Stack gap="2">
          {section.materials.map((material) => (
            <Box
              key={material.id}
              asChild
              borderWidth="1px"
              borderColor="border.default"
              borderRadius="md"
              bg="bg.surface"
              px="4"
              py="3"
              _hover={{ borderColor: "accent.solid", bg: "bg.subtle" }}
            >
              <NextLink href={routes.material(moduleSlug, material.id)}>
                <Flex align="center" justify="space-between" gap="3">
                  <HStack gap="3" minWidth="0">
                    <FileText size={16} aria-hidden />
                    <Text truncate>{material.title}</Text>
                    {material.practiceCount > 0 ? (
                      <Badge tone="accent">
                        <Terminal size={12} aria-hidden /> {material.practiceCount}
                      </Badge>
                    ) : null}
                  </HStack>
                  <ChevronRight size={16} aria-hidden />
                </Flex>
              </NextLink>
            </Box>
          ))}
        </Stack>
      )}
    </Stack>
  );
}
