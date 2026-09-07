import type { Metadata } from "next";
import { Box, Card, Stack, Text } from "@chakra-ui/react";
import { requirePageSession } from "@/lib/require-page-session";
import { PageContainer, PageHeader } from "@/components/layout/app-shell";
import { ROLE_LABEL } from "@/components/layout/navigation";

export const metadata: Metadata = { title: "Profile" };
export const dynamic = "force-dynamic";

function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <Box as="div" display={{ sm: "grid" }} gridTemplateColumns={{ sm: "10rem 1fr" }} gap="1">
      <Text as="dt" fontSize="sm" color="fg.muted">
        {label}
      </Text>
      <Text as="dd" fontSize="sm" color="fg.default">
        {children}
      </Text>
    </Box>
  );
}

export default async function CoderProfilePage() {
  const { user, expiresAt } = await requirePageSession("CODER");

  return (
    <PageContainer>
      <PageHeader title="Profile" description="Your account details." />
      <Card.Root maxWidth="lg" bg="bg.surface" borderColor="border.default">
        <Card.Body>
          <Stack as="dl" gap="4">
            <DetailRow label="Display name">{user.displayName}</DetailRow>
            <DetailRow label="Username">{user.username}</DetailRow>
            <DetailRow label="Role">{ROLE_LABEL[user.role]}</DetailRow>
            <DetailRow label="Session ends">
              <time dateTime={expiresAt.toISOString()}>{expiresAt.toLocaleString("en-GB")}</time>
            </DetailRow>
          </Stack>
        </Card.Body>
      </Card.Root>
    </PageContainer>
  );
}
