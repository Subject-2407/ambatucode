"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Alert, Card, Heading, Stack, Text } from "@chakra-ui/react";
import { loginRequestSchema, type LoginResponse } from "@ambatucode/shared";
import { apiClient, isApiError } from "@/lib/api-client";
import { homePathForRole } from "@/lib/routes";
import { BrandMark } from "@/components/layout/brand-mark";
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
    <Card.Root
      width="full"
      maxWidth="sm"
      bg="bg.surface"
      borderColor="border.default"
      boxShadow="overlay"
    >
      <Card.Body>
        <Stack gap="6">
          <Stack gap="2">
            <BrandMark />
            <Heading as="h1" size="md" color="fg.default">
              Sign in
            </Heading>
            <Text color="fg.muted" fontSize="sm">
              Use the account your Architect or Root issued you.
            </Text>
          </Stack>

          {supersededNotice ? (
            <Alert.Root status="warning" size="sm">
              <Alert.Indicator />
              <Alert.Content>
                <Alert.Description>
                  Your previous session ended because this account signed in elsewhere.
                </Alert.Description>
              </Alert.Content>
            </Alert.Root>
          ) : null}

          <form onSubmit={(event) => void handleSubmit(event)} noValidate>
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
                <Alert.Root status="error" size="sm" role="alert">
                  <Alert.Indicator />
                  <Alert.Content>
                    <Alert.Description>{formError}</Alert.Description>
                  </Alert.Content>
                </Alert.Root>
              ) : null}

              <Button type="submit" loading={submitting} loadingText="Signing in…" width="full">
                Sign in
              </Button>
            </Stack>
          </form>

          <Text fontSize="xs" color="fg.subtle">
            One account, one active session. Signing in here ends any other session for this
            account.
          </Text>
        </Stack>
      </Card.Body>
    </Card.Root>
  );
}
