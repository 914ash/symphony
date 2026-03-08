export class SymphonyError extends Error {
  readonly code: string;
  readonly details?: unknown;

  constructor(code: string, message: string, details?: unknown) {
    super(message);
    this.name = "SymphonyError";
    this.code = code;
    this.details = details;
  }
}

export function asSymphonyError(err: unknown, fallbackCode: string): SymphonyError {
  if (err instanceof SymphonyError) {
    return err;
  }

  if (err instanceof Error) {
    return new SymphonyError(fallbackCode, err.message);
  }

  return new SymphonyError(fallbackCode, "unknown_error", { err });
}

