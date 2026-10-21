import { describe, expect, it } from "vitest";
import type { QaTicket as QaTicketRow } from "@shared/db/schema";
import type { QaEvidence } from "@shared/contracts";
import {
  assertTransition,
  isClosedStatus,
  newReporterToken,
  parseEvidence,
  serializePublicTicket,
  serializeTicket,
} from "./tickets";

const NOW = new Date("2026-10-09T12:00:00.000Z");

function row(overrides: Partial<QaTicketRow> = {}): QaTicketRow {
  return {
    id: 7,
    userId: 1,
    source: "client",
    kind: "bug",
    severity: "P2",
    status: "in_progress",
    title: "Page de statut vide",
    clientMessage: "Aucun service affiché.",
    steps: null,
    expected: null,
    actual: null,
    reporterName: "Camille",
    reporterEmail: "camille@exemple.fr",
    reporterToken: "0123456789abcdef0123456789abcdef",
    pageUrl: "https://statut.exemple/status/demo",
    monitorId: null,
    evidence: null,
    fingerprint: null,
    resolvedAt: null,
    createdAt: new Date("2026-10-09T08:00:00.000Z"),
    updatedAt: new Date("2026-10-09T11:00:00.000Z"),
    ...overrides,
  };
}

describe("assertTransition", () => {
  it("accepts the documented forward moves", () => {
    expect(assertTransition("new", "triaged")).toEqual({ allowed: true });
    expect(assertTransition("new", "closed")).toEqual({ allowed: true });
    // Reopening a resolved ticket for more work is the anomaly path.
    expect(assertTransition("resolved", "in_progress")).toEqual({
      allowed: true,
    });
  });

  it("refuses a no-op and says why", () => {
    expect(assertTransition("triaged", "triaged")).toEqual({
      allowed: false,
      reason: "Déjà à cet état",
    });
  });

  it("refuses to leave a closed ticket and lists what is allowed", () => {
    const check = assertTransition("closed", "in_progress");
    expect(check.allowed).toBe(false);
    if (!check.allowed)
      expect(check.reason).toContain(
        "Transition refusée : closed → in_progress"
      );
    if (!check.allowed) expect(check.reason).toContain("aucun (ticket clos)");
  });

  it("refuses skipping triage backwards from in_progress", () => {
    const check = assertTransition("in_progress", "new");
    expect(check.allowed).toBe(false);
    if (!check.allowed)
      expect(check.reason).toContain(
        "États autorisés : waiting_client, resolved, closed"
      );
  });

  it("marks only resolved and closed as finished", () => {
    expect(isClosedStatus("resolved")).toBe(true);
    expect(isClosedStatus("closed")).toBe(true);
    expect(isClosedStatus("waiting_client")).toBe(false);
    expect(isClosedStatus("new")).toBe(false);
  });
});

describe("newReporterToken", () => {
  it("produces the 32 hex characters the public route validates", () => {
    const token = newReporterToken();
    expect(token).toMatch(/^[0-9a-f]{32}$/);
    expect(newReporterToken()).not.toBe(token);
  });
});

describe("parseEvidence", () => {
  const valid: QaEvidence = {
    capturedAt: "2026-10-09T07:55:00.000Z",
    route: "/dashboard",
    userAgent: "Mozilla/5.0",
    locale: "fr-FR",
    viewport: null,
    javaScriptErrors: [],
    failedRequests: [],
  };

  it("returns null instead of throwing on a corrupt blob", () => {
    expect(parseEvidence(null)).toBeNull();
    expect(parseEvidence("not json")).toBeNull();
    expect(parseEvidence(JSON.stringify({ route: 42 }))).toBeNull();
  });

  it("rejects an oversized capture rather than trusting the client", () => {
    const bloated = JSON.stringify({
      ...valid,
      javaScriptErrors: Array.from({ length: 11 }, (_, i) => ({
        message: `m${i}`,
        source: "a.ts",
        at: "2026-10-09T07:00:00.000Z",
      })),
    });
    expect(parseEvidence(bloated)).toBeNull();
  });

  it("keeps a well-formed capture", () => {
    expect(parseEvidence(JSON.stringify(valid))?.route).toBe("/dashboard");
  });
});

describe("serializeTicket", () => {
  it("measures idleness from the last activity, never a negative number", () => {
    const ticket = serializeTicket(row(), { monitorName: null, now: NOW });
    expect(ticket.idleMinutes).toBe(60);
    expect(ticket.resolvedAt).toBeNull();
    const future = serializeTicket(
      row({ updatedAt: new Date("2026-10-09T13:00:00.000Z") }),
      { monitorName: null, now: NOW }
    );
    expect(future.idleMinutes).toBe(0);
  });

  it("attaches the monitor name the operator has to read", () => {
    const ticket = serializeTicket(row({ monitorId: 3 }), {
      monitorName: "API publique",
      now: NOW,
    });
    expect(ticket.monitorName).toBe("API publique");
    expect(ticket.monitorId).toBe(3);
  });

  it("keeps the internal-only fields for the operator view", () => {
    const ticket = serializeTicket(row(), { monitorName: null, now: NOW });
    expect(ticket.reporterEmail).toBe("camille@exemple.fr");
  });
});

describe("serializePublicTicket", () => {
  it("exposes the reporter's own case and nothing else", () => {
    const publicTicket = serializePublicTicket(row(), "API publique");
    const serialized = JSON.stringify(publicTicket);
    expect(publicTicket.monitorName).toBe("API publique");
    expect(publicTicket.clientMessage).toBe("Aucun service affiché.");
    expect(Object.keys(publicTicket).sort()).toEqual(
      [
        "actual",
        "clientMessage",
        "createdAt",
        "expected",
        "id",
        "kind",
        "monitorName",
        "pageUrl",
        "resolvedAt",
        "severity",
        "status",
        "steps",
        "title",
        "updatedAt",
      ].sort()
    );
    // Built field by field on purpose: a new internal column must not leak here.
    expect(serialized).not.toContain("camille@exemple.fr");
    expect(serialized).not.toContain("0123456789abcdef0123456789abcdef");
    expect(serialized).not.toContain("reporterName");
    expect(serialized).not.toContain("evidence");
    expect(serialized).not.toContain("userId");
  });
});
