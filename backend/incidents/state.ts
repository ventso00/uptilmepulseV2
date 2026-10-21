export type IncidentDecision =
  | {
      kind: "none";
      nextStatus: "UNKNOWN" | "UP" | "DOWN";
      failures: number;
      successes: number;
    }
  | {
      kind: "suspect_started";
      nextStatus: "UNKNOWN" | "UP" | "DOWN";
      failures: number;
      successes: number;
    }
  | {
      kind: "confirmed";
      nextStatus: "DOWN";
      failures: number;
      successes: number;
    }
  | {
      kind: "suspect_resolved";
      nextStatus: "UP";
      failures: number;
      successes: number;
    }
  | { kind: "resolved"; nextStatus: "UP"; failures: number; successes: number };

import { INCIDENT_RULES } from "@shared/contracts";

export { INCIDENT_RULES };

export function decideIncidentTransition(input: {
  isUp: boolean;
  currentStatus: "UNKNOWN" | "UP" | "DOWN" | "PAUSED";
  consecutiveFailures: number;
  consecutiveSuccesses: number;
  hasActiveIncident: boolean;
}): IncidentDecision {
  const currentStatus =
    input.currentStatus === "PAUSED" ? "UNKNOWN" : input.currentStatus;
  if (input.isUp) {
    const successes = input.consecutiveSuccesses + 1;
    if (
      currentStatus === "DOWN" &&
      input.hasActiveIncident &&
      successes >= INCIDENT_RULES.recoveryThreshold
    ) {
      return { kind: "resolved", nextStatus: "UP", failures: 0, successes };
    }
    if (
      input.hasActiveIncident &&
      currentStatus !== "DOWN" &&
      successes >= INCIDENT_RULES.recoveryThreshold
    ) {
      return {
        kind: "suspect_resolved",
        nextStatus: "UP",
        failures: 0,
        successes,
      };
    }
    return {
      kind: "none",
      nextStatus: currentStatus === "UNKNOWN" ? "UP" : currentStatus,
      failures: 0,
      successes,
    };
  }

  const failures = input.consecutiveFailures + 1;
  if (!input.hasActiveIncident) {
    return {
      kind: "suspect_started",
      nextStatus: currentStatus === "DOWN" ? "DOWN" : currentStatus,
      failures,
      successes: 0,
    };
  }
  if (currentStatus !== "DOWN" && failures >= INCIDENT_RULES.failureThreshold) {
    return { kind: "confirmed", nextStatus: "DOWN", failures, successes: 0 };
  }
  return { kind: "none", nextStatus: currentStatus, failures, successes: 0 };
}
