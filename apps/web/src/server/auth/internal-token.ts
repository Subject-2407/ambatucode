import "server-only";
import { AppError } from "@ambatucode/shared";
import {
  INTERNAL_TOKEN_HEADER,
  isInternalTokenValid,
} from "@ambatucode/shared/auth/internal-token";
import { getServerEnv } from "../env";

/**
 * Gate for the internal endpoints apps/realtime calls. The token is scoped to
 * one action on one resource, so the route passes the scope it expects and a
 * token minted for a different attempt is refused like a forged one.
 */
export function verifyInternalRequest(request: Request, scope: string): void {
  const token = request.headers.get(INTERNAL_TOKEN_HEADER) ?? "";
  if (!isInternalTokenValid(getServerEnv().INTERNAL_API_SECRET, scope, token)) {
    throw new AppError("FORBIDDEN", "Invalid internal token");
  }
}
