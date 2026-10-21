import type { Response } from "express";
import { sendError } from "../_core/http";
import {
  FeatureUnavailableError,
  PlanLimitError,
  QuotaExceededError,
} from "./service";

/**
 * Turns a plan-limit error into its client answer. Returns false when the error
 * comes from somewhere else, so the caller can rethrow it untouched.
 */
export function respondPlanError(res: Response, error: unknown): boolean {
  if (error instanceof QuotaExceededError) {
    sendError(
      res,
      409,
      "QUOTA_EXCEEDED",
      `Le plan ${error.planName} est limité à ${error.limit} ${error.resource}.`
    );
    return true;
  }
  if (error instanceof FeatureUnavailableError) {
    sendError(
      res,
      403,
      "FEATURE_UNAVAILABLE",
      `La ${error.feature} n'est pas comprise dans le plan ${error.planName}.`
    );
    return true;
  }
  if (error instanceof PlanLimitError) {
    sendError(
      res,
      400,
      "VALIDATION_ERROR",
      `Le plan ${error.planName} impose un ${error.resource} ${
        error.direction === "at_least" ? "d'au moins" : "d'au plus"
      } ${error.limit} (demandé : ${error.requested}).`
    );
    return true;
  }
  return false;
}
