import { describe, expect, it } from "vitest";
import { parseDetail } from "./runs";

/**
 * The run ledger stores each pass's per-check detail as a JSON blob. Reading it
 * back happens on every operator page load, and a half-written or hand-edited
 * row must degrade to an empty list rather than crash the queue.
 */
describe("parseDetail", () => {
  it("returns an empty list for a run that never finished", () => {
    expect(parseDetail<unknown>(null)).toEqual([]);
  });

  it("returns an empty list for unparsable or non-array JSON", () => {
    expect(parseDetail<number>("{ not json")).toEqual([]);
    expect(parseDetail<number>('{"status":"ok"}')).toEqual([]);
  });

  it("keeps the stored array as-is", () => {
    expect(
      parseDetail<{ id: string }>(JSON.stringify([{ id: "scheduler_alive" }]))
    ).toEqual([{ id: "scheduler_alive" }]);
    expect(parseDetail<number>("[]")).toEqual([]);
  });
});
