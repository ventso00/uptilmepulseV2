import { describe, expect, it } from "vitest";
import { mapWithConcurrency } from "./pool";

const tick = () => new Promise(resolve => setTimeout(resolve, 1));

describe("bounded concurrency pool", () => {
  it("preserves input order in the results", async () => {
    const results = await mapWithConcurrency([1, 2, 3, 4, 5], 2, async n => {
      // Reverse the natural timing so ordering cannot come from arrival order.
      await new Promise(resolve => setTimeout(resolve, (6 - n) * 2));
      return n * 10;
    });
    expect(results).toEqual([10, 20, 30, 40, 50]);
  });

  it("never exceeds the requested number of in-flight tasks", async () => {
    let inFlight = 0;
    let peak = 0;
    await mapWithConcurrency(
      Array.from({ length: 20 }, (_, i) => i),
      4,
      async () => {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        await tick();
        inFlight -= 1;
      }
    );
    expect(peak).toBeLessThanOrEqual(4);
    expect(peak).toBeGreaterThan(1);
  });

  it("never runs more workers than there are items", async () => {
    let peak = 0;
    let inFlight = 0;
    await mapWithConcurrency([1, 2], 50, async () => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await tick();
      inFlight -= 1;
    });
    expect(peak).toBe(2);
  });

  it("returns an empty result without scheduling anything", async () => {
    let called = 0;
    const results = await mapWithConcurrency([], 5, async () => {
      called += 1;
      return null;
    });
    expect(results).toEqual([]);
    expect(called).toBe(0);
  });

  it("propagates a worker rejection to the caller", async () => {
    await expect(
      mapWithConcurrency([1, 2, 3], 2, async n => {
        if (n === 2) throw new Error("check failed");
        return n;
      })
    ).rejects.toThrow("check failed");
  });
});
