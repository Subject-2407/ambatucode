import type { ErrorCode } from "./errors";

export type ApiErrorBody = {
  code: ErrorCode;
  message: string;
  details?: unknown;
};

export type ApiResponse<T> = { ok: true; data: T } | { ok: false; error: ApiErrorBody };

export type ApiSuccess<T> = Extract<ApiResponse<T>, { ok: true }>;
export type ApiFailure = Extract<ApiResponse<never>, { ok: false }>;

export type Paginated<T> = {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
};
