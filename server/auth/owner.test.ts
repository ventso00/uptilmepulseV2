import { afterEach, describe, expect, it, vi } from "vitest";
import { OWNER_EMAIL, isOwnerEmail } from "./owner";

/**
 * The whole access model rests on this comparison: a normalisation difference
 * between the stored address and the guard would either lock the owner out or
 * let a look-alike address through.
 */
describe("owner guard", () => {
  it("matches the owner address whatever its casing or spacing", () => {
    expect(isOwnerEmail(OWNER_EMAIL)).toBe(true);
    expect(isOwnerEmail(`  ${OWNER_EMAIL.toUpperCase()} `)).toBe(true);
  });

  it("refuses every other address, including a missing one", () => {
    expect(isOwnerEmail("demo@uptimepulse.dev")).toBe(false);
    expect(isOwnerEmail("rajaomanjatoventso@gmail.com.evil.test")).toBe(false);
    expect(isOwnerEmail("")).toBe(false);
    expect(isOwnerEmail(null)).toBe(false);
    expect(isOwnerEmail(undefined)).toBe(false);
  });

  it("honours an override from the environment", async () => {
    vi.stubEnv("UPTIMEPULSE_OWNER_EMAIL", "  Second Owner@Test.io  ");
    vi.resetModules();
    const fresh = await import("./owner");
    expect(fresh.OWNER_EMAIL).toBe("second owner@test.io");
    expect(fresh.isOwnerEmail("SECOND OWNER@TEST.IO")).toBe(true);
    expect(fresh.isOwnerEmail(OWNER_EMAIL)).toBe(false);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });
});
