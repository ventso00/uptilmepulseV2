type ErrorLike = {
  message?: unknown;
  code?: unknown;
  cause?: unknown;
  query?: unknown;
};

function asErrorLike(value: unknown): ErrorLike | null {
  if (value == null || typeof value !== "object") return null;
  return value as ErrorLike;
}

/**
 * Drizzle wraps every driver failure in a `DrizzleQueryError`: the SQL code sits
 * on `.cause`, so reading `.code` on the thrown error never matched anything.
 */
export function driverErrorCode(error: unknown): string {
  let current = asErrorLike(error);
  for (let depth = 0; current && depth < 5; depth++) {
    if (typeof current.code === "string" && current.code) return current.code;
    current = asErrorLike(current.cause);
  }
  return "";
}

export function isDuplicateKeyError(error: unknown): boolean {
  let current = asErrorLike(error);
  for (let depth = 0; current && depth < 5; depth++) {
    if (current.code === "ER_DUP_ENTRY" || current.code === "23505")
      return true;
    // Proxies and pools sometimes flatten the driver error into a message only.
    if (
      typeof current.message === "string" &&
      current.message.includes("Duplicate entry") &&
      typeof current.query !== "string"
    )
      return true;
    current = asErrorLike(current.cause);
  }
  return false;
}

/**
 * The wrapper message is the SQL text with its bound values, which would leak
 * table names and secrets into logs and into the QA tickets that render them.
 */
export function safeErrorMessage(error: unknown, fallback = "unknown error") {
  const candidate = asErrorLike(error);
  if (!candidate) return fallback;
  if (typeof candidate.query === "string") {
    const cause = asErrorLike(candidate.cause);
    return typeof cause?.message === "string" ? cause.message : fallback;
  }
  return typeof candidate.message === "string" ? candidate.message : fallback;
}
