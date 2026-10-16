export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export function assertFound<T>(value: T | undefined, resource: string): T {
  if (value === undefined)
    throw new HttpError(404, "not_found", `${resource} not found`);
  return value;
}

export function providerFailure(error: unknown): HttpError {
  if (error instanceof HttpError) return error;
  const details = error as {
    status?: number;
    code?: string;
    name?: string;
  } | null;
  if (details?.status === 429 && details.code === "credit_balance_exhausted") {
    return new HttpError(
      429,
      "provider_quota_exhausted",
      "OpenAI API credits are exhausted",
    );
  }
  if (details?.status === 429)
    return new HttpError(
      429,
      "provider_rate_limited",
      "AI provider rate limit reached",
    );
  if (details?.status === 401 || details?.status === 403) {
    return new HttpError(
      503,
      "provider_auth_failed",
      "AI provider credentials were rejected",
    );
  }
  if (details?.status === 404)
    return new HttpError(
      503,
      "provider_model_unavailable",
      "Configured AI model is unavailable",
    );
  if (
    details?.status === 408 ||
    details?.status === 504 ||
    details?.name === "TimeoutError"
  ) {
    return new HttpError(
      504,
      "provider_timeout",
      "AI provider request timed out",
    );
  }
  return new HttpError(
    502,
    "provider_failed",
    "AI provider failed to complete the response",
  );
}
