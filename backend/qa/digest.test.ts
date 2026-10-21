import { describe, expect, it } from "vitest";
import { digestPeriodKey } from "./digest";

/**
 * The daily digest is one document per calendar day, and the ledger's unique
 * `(kind, periodKey)` is what makes a second run on the same day a no-op. The
 * key therefore has to be the UTC day, not the host's local day: a server in
 * another zone would otherwise skip the digest the operator still expects.
 */
describe("digestPeriodKey", () => {
  it("uses the UTC calendar day", () => {
    expect(digestPeriodKey(new Date("2026-10-09T00:00:00.000Z"))).toBe(
      "2026-10-09"
    );
    expect(digestPeriodKey(new Date("2026-10-09T23:59:59.999Z"))).toBe(
      "2026-10-09"
    );
    expect(digestPeriodKey(new Date("2026-10-10T00:00:00.000Z"))).toBe(
      "2026-10-10"
    );
  });

  it("sorts lexically the way it sorts chronologically", () => {
    const keys = [
      digestPeriodKey(new Date("2026-10-09T12:00:00.000Z")),
      digestPeriodKey(new Date("2026-09-30T12:00:00.000Z")),
      digestPeriodKey(new Date("2027-01-01T12:00:00.000Z")),
    ];
    expect([...keys].sort()).toEqual([
      "2026-09-30",
      "2026-10-09",
      "2027-01-01",
    ]);
  });
});
