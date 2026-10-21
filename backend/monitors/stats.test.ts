import { describe, expect, it } from "vitest";
import { calculateUptime } from "./stats";

function log(isUp: boolean, responseTimeMs: number | null, minutesAgo: number) {
  return {
    id: minutesAgo,
    monitorId: 1,
    statusCode: isUp ? 200 : 503,
    responseTimeMs,
    isUp,
    classification: isUp
      ? ("UP_HTTP_2XX" as const)
      : ("DOWN_HTTP_5XX" as const),
    errorMessage: null,
    dnsMs: null,
    tcpMs: null,
    tlsMs: null,
    ttfbMs: null,
    checkedAt: new Date(Date.now() - minutesAgo * 60_000),
  };
}

describe("monitor uptime statistics", () => {
  it("uses successful checks divided by total recorded checks", () => {
    const stats = calculateUptime([
      log(true, 120, 1),
      log(true, 180, 2),
      log(false, null, 3),
    ]);
    expect(stats.totalChecks).toBe(3);
    expect(stats.successfulChecks).toBe(2);
    expect(stats.uptimePercent).toBe(66.67);
    expect(stats.averageResponseTimeMs).toBe(150);
  });

  it("returns null uptime when no checks were recorded", () => {
    expect(calculateUptime([]).uptimePercent).toBeNull();
  });
});
