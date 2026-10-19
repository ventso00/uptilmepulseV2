import { describe, expect, it } from "vitest";
import type { Monitor } from "@shared/db/schema";
import {
  LATENCY_SAMPLE_CAP_PER_MONITOR,
  LATENCY_WINDOW_DAYS,
  SLA_TARGET_PERCENT,
  buildHourlyBuckets,
  certificateFrom,
  errorBudget,
  percentile,
  windowFromCounts,
  type SampleRow,
} from "./analysis";

/**
 * The public status page publishes numbers an operator is expected to audit, so
 * the maths behind them is tested in isolation: exact percentiles, window
 * ratios, hour bucketing, the error budget, and the certificate countdown.
 */
describe("percentile", () => {
  it("returns null on an empty sample instead of inventing a value", () => {
    expect(percentile([], 50)).toBeNull();
  });

  it("picks the nearest rank without interpolating between checks", () => {
    // ceil(0.5 * 4) = 2 -> second ascending value, not the mean of 2 and 3.
    expect(percentile([10, 20, 30, 40], 50)).toBe(20);
    expect(percentile([10, 20, 30, 40], 90)).toBe(40);
    expect(percentile([10, 20, 30, 40], 95)).toBe(40);
    expect(percentile([10, 20, 30, 40], 100)).toBe(40);
    expect(percentile([10, 20, 30, 40], 0)).toBe(10);
  });

  it("clamps out-of-range quantiles to the sample", () => {
    expect(percentile([7], 99)).toBe(7);
  });
});

describe("windowFromCounts", () => {
  it("leaves uptime null when the window holds no check", () => {
    expect(windowFromCounts(0, 0)).toEqual({
      uptimePercent: null,
      totalChecks: 0,
      failedChecks: 0,
    });
  });

  it("rounds to two decimals and derives failures from the total", () => {
    expect(windowFromCounts(287, 288)).toEqual({
      uptimePercent: 99.65,
      totalChecks: 288,
      failedChecks: 1,
    });
    expect(windowFromCounts(1, 3).uptimePercent).toBe(33.33);
  });
});

function row(
  overrides: Partial<SampleRow> & Pick<SampleRow, "checkedAt">
): SampleRow {
  return {
    monitorId: 1,
    responseTimeMs: 100,
    isUp: true,
    dnsMs: null,
    tcpMs: null,
    tlsMs: null,
    ttfbMs: null,
    ...overrides,
  };
}

describe("buildHourlyBuckets", () => {
  const endTime = new Date("2026-10-08T08:30:00.000Z");

  it("emits one zero-filled bucket per hour, oldest first", () => {
    const buckets = buildHourlyBuckets([], endTime, 3);
    expect(buckets.map(bucket => bucket.time)).toEqual([
      "2026-10-08T06:00:00.000Z",
      "2026-10-08T07:00:00.000Z",
      "2026-10-08T08:00:00.000Z",
    ]);
    expect(buckets[2]).toMatchObject({ up: 0, down: 0, samples: 0 });
    // A missing bar means "no check yet", never a fabricated outage.
    expect(buckets.every(bucket => bucket.averageMs === null)).toBe(true);
  });

  it("averages only successful timings and counts failures separately", () => {
    const buckets = buildHourlyBuckets(
      [
        row({
          checkedAt: new Date("2026-10-08T08:05:00.000Z"),
          responseTimeMs: 100,
        }),
        row({
          checkedAt: new Date("2026-10-08T08:25:00.000Z"),
          responseTimeMs: 200,
        }),
        row({
          checkedAt: new Date("2026-10-08T08:45:00.000Z"),
          isUp: false,
          responseTimeMs: null,
        }),
      ],
      endTime,
      3
    );
    expect(buckets[2]).toEqual({
      time: "2026-10-08T08:00:00.000Z",
      up: 2,
      down: 1,
      averageMs: 150,
      samples: 3,
    });
  });

  it("drops rows outside the requested window", () => {
    const buckets = buildHourlyBuckets(
      [
        row({ checkedAt: new Date("2026-10-08T05:59:59.000Z") }),
        row({ checkedAt: new Date("2026-10-08T09:00:00.000Z") }),
      ],
      endTime,
      3
    );
    expect(buckets.every(bucket => bucket.samples === 0)).toBe(true);
  });
});

describe("errorBudget", () => {
  it("keeps both fields null without measured uptime", () => {
    expect(errorBudget({ uptimePercent: null, windowDays: 90 })).toEqual({
      targetPercent: SLA_TARGET_PERCENT,
      windowDays: 90,
      errorBudgetMinutes: null,
      consumedMinutes: null,
    });
  });

  it("splits the allowance at the exact target", () => {
    const sla = errorBudget({ uptimePercent: 99.9, windowDays: 1 });
    // 1 440 min × 0.1 % = 1.44 min allowed, fully consumed.
    expect(sla.errorBudgetMinutes).toBe(0);
    expect(sla.consumedMinutes).toBe(1.44);
  });

  it("reports remaining budget when measured uptime is better than the target", () => {
    const sla = errorBudget({ uptimePercent: 99.95, windowDays: 1 });
    expect(sla.consumedMinutes).toBe(0.72);
    expect(sla.errorBudgetMinutes).toBe(0.72);
  });

  it("caps consumption at the allowance once the target is missed", () => {
    const sla = errorBudget({ uptimePercent: 99, windowDays: 1 });
    expect(sla.errorBudgetMinutes).toBe(0);
    expect(sla.consumedMinutes).toBe(1.44);
  });
});

describe("certificateFrom", () => {
  const now = new Date("2026-10-08T00:00:00.000Z");

  function monitorWith(ssl: Partial<Monitor>): Monitor {
    return {
      sslValidTo: new Date("2026-10-22T00:00:00.000Z"),
      sslIssuer: "Let's Encrypt",
      sslSubject: "exemple.com",
      ...ssl,
    } as Monitor;
  }

  it("counts whole days remaining", () => {
    expect(certificateFrom(monitorWith({}), now)).toEqual({
      issuer: "Let's Encrypt",
      subject: "exemple.com",
      validTo: "2026-10-22T00:00:00.000Z",
      daysRemaining: 14,
    });
  });

  it("returns null rather than a half-known certificate", () => {
    expect(certificateFrom(monitorWith({ sslValidTo: null }), now)).toBeNull();
    expect(certificateFrom(monitorWith({ sslIssuer: null }), now)).toBeNull();
    expect(certificateFrom(monitorWith({ sslSubject: null }), now)).toBeNull();
  });

  it("goes negative once the certificate has expired", () => {
    expect(
      certificateFrom(
        monitorWith({ sslValidTo: new Date("2026-10-06T00:00:00.000Z") }),
        now
      )?.daysRemaining
    ).toBe(-2);
  });
});

describe("sample bounds", () => {
  it("caps the read above the theoretical maximum for a 14-day sample", () => {
    // 300 s is the schema floor for intervalSeconds, so a monitor can never
    // emit more than 288 checks per day. The 14-day sample (current window +
    // comparison window) therefore holds at most 4 032 rows per monitor, and
    // the cap must stay above that: a shared LIMIT ordered by recency drops the
    // OLDEST rows first, which would bias the trend window instead of the
    // current one.
    const checksPerDay = (24 * 60 * 60) / 300;
    const maxRowsInSampleWindow = 2 * LATENCY_WINDOW_DAYS * checksPerDay;
    expect(checksPerDay).toBe(288);
    expect(maxRowsInSampleWindow).toBe(4032);
    expect(LATENCY_SAMPLE_CAP_PER_MONITOR).toBeGreaterThan(
      maxRowsInSampleWindow
    );
  });
});
