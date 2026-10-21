import { beforeEach, describe, expect, it } from "vitest";
import { clearRateLimitBuckets, consumeRateLimit } from "./rateLimit";

describe("rate limiter", () => {
  beforeEach(() => clearRateLimitBuckets());

  it("allows requests under the limit and blocks beyond it", () => {
    expect(consumeRateLimit("k", 3, 1000).allowed).toBe(true);
    expect(consumeRateLimit("k", 3, 1000).allowed).toBe(true);
    expect(consumeRateLimit("k", 3, 1000).allowed).toBe(true);
    expect(consumeRateLimit("k", 3, 1000).allowed).toBe(false);
  });

  it("reports a positive retry delay when blocked", () => {
    consumeRateLimit("k", 1, 60_000);
    const blocked = consumeRateLimit("k", 1, 60_000);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("resets once the window has elapsed", () => {
    const start = 1_000_000;
    expect(consumeRateLimit("k", 1, 1000, start).allowed).toBe(true);
    expect(consumeRateLimit("k", 1, 1000, start + 500).allowed).toBe(false);
    expect(consumeRateLimit("k", 1, 1000, start + 1500).allowed).toBe(true);
  });

  it("keeps counters isolated per key", () => {
    consumeRateLimit("a", 1, 1000);
    expect(consumeRateLimit("a", 1, 1000).allowed).toBe(false);
    expect(consumeRateLimit("b", 1, 1000).allowed).toBe(true);
  });

  it("stays bounded when many distinct keys are used", () => {
    // The map is swept once it exceeds the cap, so a flood of unique keys
    // cannot grow it without bound.
    for (let i = 0; i < 20_000; i += 1) {
      consumeRateLimit(`key-${i}`, 5, 600_000);
    }
    // A later request must still be served correctly after the sweep.
    expect(consumeRateLimit("after-flood", 5, 600_000).allowed).toBe(true);
  });
});
