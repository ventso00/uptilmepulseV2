import { describe, expect, it } from "vitest";
import { RETENTION, retentionCutoffs } from "./retention";

describe("data retention policy", () => {
  it("keeps raw checks well beyond the 30-day UI window", () => {
    expect(RETENTION.pingLogsDays).toBeGreaterThan(30);
    expect(RETENTION.deliveriesDays).toBeGreaterThanOrEqual(
      RETENTION.pingLogsDays
    );
  });

  it("computes cutoffs from the provided reference date", () => {
    const now = new Date("2026-10-07T12:00:00.000Z");
    const cutoffs = retentionCutoffs(now);
    expect(cutoffs.pingLogs.toISOString()).toBe(
      new Date(
        now.getTime() - RETENTION.pingLogsDays * 86_400_000
      ).toISOString()
    );
    expect(cutoffs.deliveries.toISOString()).toBe(
      new Date(
        now.getTime() - RETENTION.deliveriesDays * 86_400_000
      ).toISOString()
    );
  });

  it("batches deletions so a sweep can never hold a long lock", () => {
    expect(RETENTION.batchSize).toBeLessThanOrEqual(5000);
    expect(RETENTION.batchSize).toBeGreaterThan(0);
  });
});
