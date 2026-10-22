import { afterEach, describe, expect, it } from "vitest";
import type { Request, Response } from "express";
import { clearRateLimitBuckets } from "../auth/rateLimit";
import { limitProbes } from "./diagnostic";

/**
 * The probe reaches out to a third-party host on behalf of an anonymous
 * visitor, so its throttle is the only thing between the landing page and an
 * outbound-request flood. These cases pin the per-IP budget.
 */

type CapturedResponse = Response & { statuses: number[] };

function fakeResponse(): CapturedResponse {
  const statuses: number[] = [];
  const res = {
    statuses,
    setHeader() {
      return res;
    },
    status(code: number) {
      statuses.push(code);
      return { json() {} };
    },
  } as unknown as CapturedResponse;
  return res;
}

function probeFrom(ip: string, res: CapturedResponse): boolean {
  return limitProbes({ ip } as unknown as Request, res);
}

afterEach(() => {
  clearRateLimitBuckets();
});

describe("limitProbes", () => {
  it("allows eight probes from one address inside the window", () => {
    const res = fakeResponse();
    for (let attempt = 1; attempt <= 8; attempt += 1) {
      expect(probeFrom("203.0.113.7", res)).toBe(true);
    }
    expect(res.statuses).toEqual([]);
  });

  it("refuses the ninth probe from the same address with 429", () => {
    const res = fakeResponse();
    for (let attempt = 0; attempt < 8; attempt += 1)
      probeFrom("203.0.113.7", res);
    expect(probeFrom("203.0.113.7", res)).toBe(false);
    expect(res.statuses).toEqual([429]);
  });

  it("keeps one visitor's budget separate from another's", () => {
    const res = fakeResponse();
    for (let attempt = 0; attempt < 8; attempt += 1)
      probeFrom("203.0.113.7", res);
    expect(probeFrom("198.51.100.4", res)).toBe(true);
    expect(res.statuses).toEqual([]);
  });

  it("shares a budget between probes that expose no client address", () => {
    const res = fakeResponse();
    for (let attempt = 0; attempt < 8; attempt += 1) {
      expect(probeFrom(undefined as unknown as string, res)).toBe(true);
    }
    expect(probeFrom(undefined as unknown as string, res)).toBe(false);
  });
});
