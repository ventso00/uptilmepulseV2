import { describe, expect, it } from "vitest";
import {
  captureEvidence,
  clearEvidence,
  recordFailedRequest,
  recordJavaScriptError,
} from "./qaContext";

/**
 * The capture buffer is what turns "the page is broken" into something an
 * engineer can act on, and it is the only place the reporter's own session
 * leaves the browser. Both halves matter: it must keep the recent entries, and
 * it must keep the query string out of the route.
 */

const NOW = new Date("2026-10-09T08:00:00.000Z");

function location(pathname: string, search = ""): Location {
  return { pathname, search } as unknown as Location;
}

describe("captureEvidence", () => {
  it("records the visible path without its query string", () => {
    clearEvidence();
    const evidence = captureEvidence(
      NOW,
      location("/support/0123456789abcdef0123456789abcdef", "?jeton=secret")
    );
    // A token can live in a query string; the route must not carry it.
    expect(evidence.route).toBe("/support/0123456789abcdef0123456789abcdef");
    expect(JSON.stringify(evidence)).not.toContain("secret");
    expect(evidence.capturedAt).toBe("2026-10-09T08:00:00.000Z");
  });

  it("falls back to a neutral route outside a browser", () => {
    clearEvidence();
    const evidence = captureEvidence(NOW, undefined);
    expect(evidence.route).toBe("/");
    expect(evidence.viewport).toBeNull();
    expect(evidence.userAgent.length).toBeGreaterThan(0);
    expect(evidence.locale.length).toBeGreaterThan(0);
  });

  it("snapshots a copy, so later errors cannot rewrite a filed report", () => {
    clearEvidence();
    const first = captureEvidence(NOW, location("/dashboard"));
    recordJavaScriptError("survenue après le signalement");
    expect(first.javaScriptErrors).toEqual([]);
    expect(
      captureEvidence(NOW, location("/dashboard")).javaScriptErrors
    ).toHaveLength(1);
  });
});

describe("evidence buffers", () => {
  it("keeps the ten most recent JavaScript errors", () => {
    clearEvidence();
    for (let i = 1; i <= 12; i += 1) recordJavaScriptError(`m${i}`);
    const errors = captureEvidence(NOW, location("/x")).javaScriptErrors;
    expect(errors).toHaveLength(10);
    expect(errors[0]?.message).toBe("m3");
    expect(errors.at(-1)?.message).toBe("m12");
  });

  it("keeps the ten most recent failed calls", () => {
    clearEvidence();
    for (let i = 1; i <= 11; i += 1)
      recordFailedRequest(
        `/api/route-${i}`,
        500,
        null,
        null,
        NOW.toISOString()
      );
    const calls = captureEvidence(NOW, location("/x")).failedRequests;
    expect(calls).toHaveLength(10);
    expect(calls[0]?.path).toBe("/api/route-2");
  });

  it("clips what the contract would otherwise refuse", () => {
    clearEvidence();
    recordJavaScriptError("a".repeat(400), "b".repeat(400));
    recordFailedRequest("c".repeat(400), null, "E".repeat(80), null);
    const evidence = captureEvidence(NOW, location("/x"));
    expect(evidence.javaScriptErrors[0]?.message).toHaveLength(300);
    expect(evidence.javaScriptErrors[0]?.message.endsWith("…")).toBe(true);
    expect(evidence.failedRequests[0]?.path).toHaveLength(300);
    expect(evidence.failedRequests[0]?.code).toHaveLength(60);
    expect(evidence.failedRequests[0]?.status).toBeNull();
  });

  it("clears both buffers on request", () => {
    recordJavaScriptError("erreur");
    recordFailedRequest("/api/z", 502, null, 12);
    clearEvidence();
    const evidence = captureEvidence(NOW, location("/x"));
    expect(evidence.javaScriptErrors).toEqual([]);
    expect(evidence.failedRequests).toEqual([]);
  });
});
