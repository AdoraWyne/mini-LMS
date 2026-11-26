import type { ApiErrorBody, ApiSuccess } from "@/lib/api/http";
import type { ValidationDetails } from "@/lib/api/errors";

/**
 * The browser's only way to talk to the backend: OUR API routes (decision 11), never
 * Supabase tables directly. Reads the one response envelope: `{ data }` or `{ error }`.
 */

/** An error answer from our API, with the status so the UI can react (401 -> login, 409 -> message). */
export class ApiClientError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly details?: ValidationDetails,
  ) {
    super(message);
    this.name = "ApiClientError";
  }
}

function isErrorBody(body: unknown): body is ApiErrorBody {
  return typeof body === "object" && body !== null && "error" in body;
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const response = await fetch(path, {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  // Our API always answers JSON; anything else (e.g. a proxy error page) is treated as a failure.
  const json: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    if (isErrorBody(json)) throw new ApiClientError(response.status, json.error.message, json.error.details);
    throw new ApiClientError(response.status, `Request failed (${response.status})`);
  }
  return (json as ApiSuccess<T>).data;
}

export const apiClient = {
  get: <T>(path: string) => request<T>("GET", path),
  post: <T>(path: string, body: unknown) => request<T>("POST", path, body),
  patch: <T>(path: string, body: unknown) => request<T>("PATCH", path, body),
};
