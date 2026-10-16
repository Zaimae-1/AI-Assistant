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
