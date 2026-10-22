import type { Express, Request, Response } from "express";
import { consumeRateLimit } from "../auth/rateLimit";
import { asyncHandler, sendError } from "../_core/http";
import { TargetValidationError, validateUrlSyntax } from "../monitors/ssrf";
import { performHttpCheck } from "./client";

/** Same budget a monitor would get, so the hero measurement matches the product. */
const PROBE_TIMEOUT_MS = 10_000;

/**
 * A probe opens a socket to a third-party host, so it is throttled far tighter
 * than the authenticated write paths. The bucket is per IP because visitors
 * have no session yet.
 */
export function limitProbes(req: Request, res: Response): boolean {
  const rate = consumeRateLimit(
    `diagnostic:${req.ip ?? "unknown"}`,
    8,
    60_000
  );
  if (rate.allowed) return true;
  sendError(res, 429, "RATE_LIMITED", "Too many requests", rate.retryAfterSeconds);
  return false;
}

export function registerDiagnosticRoute(app: Express): void {
  app.post(
    "/api/diagnostic",
    asyncHandler(async (req: Request, res: Response) => {
      if (!limitProbes(req, res)) return;
      const rawUrl = typeof req.body?.url === "string" ? req.body.url.trim() : "";
      let target: URL;
      try {
        target = validateUrlSyntax(rawUrl);
      } catch (error) {
        if (error instanceof TargetValidationError)
          return sendError(res, 400, error.code, error.message);
        return sendError(res, 400, "INVALID_TARGET", "URL is invalid");
      }

      const result = await performHttpCheck(
        target.toString(),
        PROBE_TIMEOUT_MS,
        null
      );
      return res
        .set("Cache-Control", "no-store")
        .json({ url: target.toString(), ...result });
    })
  );
}
