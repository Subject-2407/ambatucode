"use client";

import { useRouter } from "next/navigation";
import { HStack, Text } from "@chakra-ui/react";
import { Clock, UserPlus } from "lucide-react";
import type { ModuleSummary } from "@ambatucode/shared";
import { Badge } from "@/components/ui/badge";
import { Button, type ButtonProps } from "@/components/ui/button";
import { toaster } from "@/components/ui/toaster";
import { useRequestEnrollment } from "@/hooks/use-enrollments";
import { isApiError } from "@/lib/api-client";

/**
 * The one control that turns a listed module into a readable one.
 *
 * It shows the Coder where they stand rather than a bare button: a pending
 * request is the normal outcome on a Closed module, and presenting it as a
 * state instead of a failed click is what keeps that from reading like an
 * error.
 */
export function EnrollButton({
  module,
  size = "md",
  onEnrolled,
}: {
  module: Pick<ModuleSummary, "id" | "visibility" | "viewer">;
  size?: ButtonProps["size"];
  onEnrolled?: () => void;
}) {
  const router = useRouter();
  const { mutateAsync, isPending } = useRequestEnrollment();
  const status = module.viewer.enrollmentStatus;

  if (status === "PENDING") {
    return (
      <HStack gap="2">
        <Badge tone="warning">
          <Clock size={12} aria-hidden /> Awaiting approval
        </Badge>
      </HStack>
    );
  }

  async function enroll() {
    try {
      const result = await mutateAsync(module.id);
      toaster.success({
        title: result.canRead ? "You are enrolled" : "Request sent",
        description: result.canRead
          ? "The materials are open to you now."
          : "The Architect will review your request.",
      });
      onEnrolled?.();
      router.refresh();
    } catch (error) {
      toaster.error({
        title: "Could not enroll",
        description: isApiError(error) ? error.userMessage : "Please try again.",
      });
    }
  }

  const label =
    status === "REJECTED"
      ? "Ask again"
      : module.visibility === "CLOSED"
        ? "Request access"
        : "Enroll";

  return (
    <HStack gap="3">
      <Button size={size} loading={isPending} onClick={() => void enroll()} alignSelf="start">
        <UserPlus aria-hidden />
        {label}
      </Button>
      {status === "REJECTED" ? (
        <Text fontSize="xs" color="fg.muted">
          Your previous request was declined.
        </Text>
      ) : null}
    </HStack>
  );
}
