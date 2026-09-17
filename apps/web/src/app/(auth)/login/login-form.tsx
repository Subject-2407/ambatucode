"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Alert, Box, Stack, Text } from "@chakra-ui/react";
import { loginRequestSchema, type LoginResponse } from "@ambatucode/shared";
import { apiClient, isApiError } from "@/lib/api-client";
import { homePathForRole } from "@/lib/routes";
import { BrandMark } from "@/components/layout/brand-mark";
import { PixelFrame } from "@/components/ui/pixel-frame";
import { PixelHorizon } from "@/components/ornament/pixel-horizon";
import { Button } from "@/components/ui/button";
import { TextField } from "@/components/ui/input";

type FieldErrors = { username?: string; password?: string };

/**
 * UNAUTHENTICATED means "your session ended" everywhere else in the app, but on
 * this screen it means the credentials were wrong, so the shared copy does not
 * fit. The wording stays deliberately vague: the server returns the same code
 * for an unknown username, a wrong password, and a rate-limit lockout, and
 * saying which would let an attacker enumerate accounts.
 */
function loginFailureMessage(error: unknown): string {
  if (!isApiError(error)) return "Something went wrong. Please try again.";
  return error.code === "UNAUTHENTICATED" ? "Incorrect username or password." : error.userMessage;
}

/**
 * Client-side validation uses the very same Zod schema the route handler
 * enforces, so a rejected shape is caught before a request goes out. It is a
 * convenience, never the check that matters — the server validates again.
 */
export function LoginForm({ supersededNotice }: { supersededNotice: boolean }) {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);

    const parsed = loginRequestSchema.safeParse({ username, password });
    if (!parsed.success) {
      const next: FieldErrors = {};
      for (const issue of parsed.error.issues) {
        const field = issue.path[0];
        if (field === "username") next.username ??= issue.message;
        if (field === "password") next.password ??= issue.message;
      }
      setFieldErrors(next);
      return;
    }

    setFieldErrors({});
    setSubmitting(true);
    try {
      const result = await apiClient.post<LoginResponse>("/api/auth/login", parsed.data);
      router.replace(homePathForRole(result.user.role));
      // The role layouts read the session on the server; without this they
      // would render from the cached, signed-out tree.
      router.refresh();
    } catch (error) {
      setFormError(loginFailureMessage(error));
      setSubmitting(false);
    }
  }

  return (
    <PixelFrame
      tone="emphasized"
      surface="bg.canvas"
      width="full"
      maxWidth="lg"
      position="relative"
      overflow="hidden"
      boxShadow="overlay"
    >
      <Stack
        gap="7"
        align="center"
        textAlign="center"
        paddingX={{ base: "5", sm: "10" }}
        paddingTop={{ base: "10", sm: "14" }}
        // Leaves the horizon its band without the form sitting on top of it.
        paddingBottom="28"
        position="relative"
      >
        <Stack gap="2" align="center">
          <BrandMark size="hero" />
          <Text textStyle="display" fontSize="xs" color="accent.fg" letterSpacing="0.2em">
            Offline
            <Box as="span" aria-hidden animation="caretBlink 1.1s steps(1, end) infinite">
              {" – ready_"}
            </Box>
          </Text>
        </Stack>

        {supersededNotice ? (
          <Alert.Root status="warning" size="sm" borderRadius="0" textAlign="start">
            <Alert.Indicator />
            <Alert.Content>
              <Alert.Description>
                Your previous session ended because this account signed in elsewhere.
              </Alert.Description>
            </Alert.Content>
          </Alert.Root>
        ) : null}

        {/* A plain form element: Chakra's polymorphic Box does not carry the
            form-specific props, and the submit handler is typed against the
            real element rather than a div wearing its tag. */}
        <form
          onSubmit={(event) => void handleSubmit(event)}
          noValidate
          style={{ width: "100%", textAlign: "start" }}
        >
          <Stack gap="4">
            <TextField
              label="Username"
              name="username"
              autoComplete="username"
              autoFocus
              required
              value={username}
              onChange={(event) => setUsername(event.currentTarget.value)}
              errorText={fieldErrors.username}
            />
            <TextField
              label="Password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(event) => setPassword(event.currentTarget.value)}
              errorText={fieldErrors.password}
            />

            {formError ? (
              <Alert.Root status="error" size="sm" role="alert" borderRadius="0">
                <Alert.Indicator />
                <Alert.Content>
                  <Alert.Description>{formError}</Alert.Description>
                </Alert.Content>
              </Alert.Root>
            ) : null}

            <Button
              type="submit"
              size="lg"
              loading={submitting}
              loadingText="Signing in"
              width="full"
              marginTop="2"
            >
              Press start
            </Button>
          </Stack>
        </form>

        <Text fontSize="xs" color="fg.subtle" maxWidth="44ch">
          One account, one active session. Signing in here ends any other session for this account.
        </Text>

        <PixelHorizon />
      </Stack>
    </PixelFrame>
  );
}
