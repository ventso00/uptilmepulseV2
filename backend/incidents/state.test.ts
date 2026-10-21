import { describe, expect, it } from "vitest";
import { decideIncidentTransition } from "./state";

describe("incident state machine", () => {
  it("starts a suspect incident on the first failure without notifying", () => {
    expect(
      decideIncidentTransition({
        isUp: false,
        currentStatus: "UNKNOWN",
        consecutiveFailures: 0,
        consecutiveSuccesses: 0,
        hasActiveIncident: false,
      })
    ).toMatchObject({
      kind: "suspect_started",
      failures: 1,
      nextStatus: "UNKNOWN",
    });
  });

  it("confirms only on the third consecutive failure", () => {
    expect(
      decideIncidentTransition({
        isUp: false,
        currentStatus: "UNKNOWN",
        consecutiveFailures: 2,
        consecutiveSuccesses: 0,
        hasActiveIncident: true,
      })
    ).toMatchObject({ kind: "confirmed", failures: 3, nextStatus: "DOWN" });
  });

  it("resolves a confirmed incident only after two successes", () => {
    expect(
      decideIncidentTransition({
        isUp: true,
        currentStatus: "DOWN",
        consecutiveFailures: 3,
        consecutiveSuccesses: 1,
        hasActiveIncident: true,
      })
    ).toMatchObject({ kind: "resolved", successes: 2, nextStatus: "UP" });
  });

  it("keeps a suspect incident open after one success", () => {
    expect(
      decideIncidentTransition({
        isUp: true,
        currentStatus: "UP",
        consecutiveFailures: 1,
        consecutiveSuccesses: 0,
        hasActiveIncident: true,
      })
    ).toMatchObject({ kind: "none", successes: 1, nextStatus: "UP" });
    expect(
      decideIncidentTransition({
        isUp: true,
        currentStatus: "UP",
        consecutiveFailures: 1,
        consecutiveSuccesses: 1,
        hasActiveIncident: true,
      })
    ).toMatchObject({
      kind: "suspect_resolved",
      successes: 2,
      nextStatus: "UP",
    });
  });
});
