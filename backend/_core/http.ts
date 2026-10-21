import type {
  ErrorRequestHandler,
  Request,
  RequestHandler,
  Response,
} from "express";
import { getApplicationUser } from "../auth/session";
import { isOwnerEmail } from "../auth/owner";
import { driverErrorCode, safeErrorMessage } from "./db-error";
import type { User } from "@shared/db/schema";

/**
 * Express 4 does not forward rejections from async handlers to the error
 * pipeline: the request hangs until the gateway times out and the rejection
 * escapes as an unhandled rejection. Every route must therefore be wrapped in
 * `asyncHandler`, and `errorHandler` must be registered last.
 */
export function asyncHandler(
  handler: (
    req: Request,
    res: Response,
    next: (error?: unknown) => void
  ) => unknown
): RequestHandler {
  return (req, res, next) => {
    try {
      const result = handler(req, res, next);
      if (result instanceof Promise) {
        result.catch(next);
      }
    } catch (error) {
      next(error);
    }
  };
}

export function sendError(
  res: Response,
  status: number,
  code: string,
  message: string,
  retryAfterSeconds?: number
): void {
  if (retryAfterSeconds) res.setHeader("Retry-After", retryAfterSeconds);
  res.status(status).json({ error: { code, message } });
}

export function parseId(value: string): number | null {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

/**
 * Resolves the authenticated user, or responds and returns null.
 * The resolved user is memoised on the request so a route that authenticates
 * twice (REST guard + tRPC context) only pays for one database join.
 *
 * Beyond the session check, the account must be the owner: a session minted
 * before the lock — or by a hand-edited row — stays useless instead of turning
 * into access. Public surfaces (status pages, issue intake) never call this.
 */
export async function requireUser(
  req: Request,
  res: Response
): Promise<User | null> {
  const cache = req as Request & { __appUser?: User | null };
  const user = cache.__appUser ?? (await getApplicationUser(req));
  cache.__appUser = user;
  if (!user) {
    sendError(res, 401, "UNAUTHORIZED", "Authentication required");
    return null;
  }
  if (!isOwnerEmail(user.email)) {
    sendError(res, 403, "ACCESS_RESERVED", "Accès réservé au créateur.");
    return null;
  }
  return user;
}

/**
 * Same as `requireUser`, plus the `users.role = 'admin'` check. The role lives
 * on the session user, so no extra query is needed; the 403 answer stays
 * indistinguishable from a plain refusal to avoid confirming account existence.
 */
export async function requireAdmin(
  req: Request,
  res: Response
): Promise<User | null> {
  const user = await requireUser(req, res);
  if (!user) return null;
  if (user.role !== "admin") {
    sendError(res, 403, "FORBIDDEN", "Accès réservé à l’administrateur.");
    return null;
  }
  return user;
}

const DATABASE_HINTS = [
  "ECONNREFUSED",
  "ETIMEDOUT",
  "PROTOCOL_CONNECTION_LOST",
  "ER_ACCESS_DENIED_ERROR",
  "ENOTFOUND",
  "ER_BAD_DB_ERROR",
];

function isDatabaseError(error: unknown): boolean {
  return DATABASE_HINTS.includes(driverErrorCode(error));
}

/**
 * Body-parser rejections arrive as generic errors carrying an HTTP status.
 * Without this they surfaced as 500, telling the client the server broke
 * rather than that the request was malformed.
 */
function parserStatus(error: unknown): number | null {
  if (!(error instanceof Error)) return null;
  const candidate = error as Error & {
    status?: number;
    statusCode?: number;
    type?: string;
  };
  if (candidate.type === "entity.too.large") return 413;
  if (candidate.type === "entity.parse.failed") return 400;
  const status = candidate.status ?? candidate.statusCode;
  if (status === 413 || status === 400) return status;
  return null;
}

/**
 * Terminal error pipeline. Keeps internal details out of the response body and
 * emits a structured log line so failures stay diagnosable.
 */
export const errorHandler: ErrorRequestHandler = (error, req, res, next) => {
  if (res.headersSent) return next(error);

  const message = safeErrorMessage(error, "request failed");

  const rejected = parserStatus(error);
  if (rejected === 413)
    return sendError(
      res,
      413,
      "PAYLOAD_TOO_LARGE",
      "Request body is too large"
    );
  if (rejected === 400)
    return sendError(res, 400, "VALIDATION_ERROR", "Request body is malformed");

  if (isDatabaseError(error)) {
    console.error(
      JSON.stringify({
        event: "database_error",
        path: req.originalUrl,
        code: driverErrorCode(error),
        message,
      })
    );
    return sendError(res, 503, "DATABASE_UNAVAILABLE", "Service unavailable");
  }

  console.error(
    JSON.stringify({
      event: "unhandled_request_error",
      method: req.method,
      path: req.originalUrl,
      message,
    })
  );
  return sendError(res, 500, "INTERNAL_ERROR", "An unexpected error occurred");
};

export const notFoundHandler: RequestHandler = (req, res) => {
  sendError(res, 404, "NOT_FOUND", "Route not found");
};
