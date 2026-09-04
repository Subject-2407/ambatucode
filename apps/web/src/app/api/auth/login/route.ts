import { loginRequestSchema, type LoginResponse } from "@ambatucode/shared";
import { buildSessionCookie } from "@/server/auth/session";
import { clientIpFrom, ok, parseJsonBody, route } from "@/server/http/respond";
import { login } from "@/server/services/auth";

export const dynamic = "force-dynamic";

export const POST = route(async (request) => {
  const body = await parseJsonBody(request, loginRequestSchema);

  const outcome = await login({
    username: body.username,
    password: body.password,
    userAgent: request.headers.get("user-agent"),
    ipAddress: clientIpFrom(request),
  });

  const response = ok<LoginResponse>({
    user: outcome.user,
    expiresAt: outcome.expiresAt.toISOString(),
  });

  const cookie = buildSessionCookie(outcome.token, outcome.expiresAt);
  response.cookies.set(cookie.name, cookie.value, cookie.options);

  return response;
});
