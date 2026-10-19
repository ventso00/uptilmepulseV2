import { describe, expect, it } from "vitest";
import {
  assertChannelQuota,
  assertIntervalAllowed,
  assertKeywordAllowed,
  assertMonitorQuota,
  assertTimeoutAllowed,
  FeatureUnavailableError,
  PlanLimitError,
  QuotaExceededError,
  resolvePlan,
  type EffectivePlan,
} from "./service";

const PRO: EffectivePlan = {
  slug: "pro",
  name: "Pro",
  maxMonitors: 25,
  minIntervalSeconds: 300,
  maxTimeoutMs: 30_000,
  maxChannels: 3,
  allowKeyword: true,
  priceCents: 900,
  trialDays: 14,
};

const FREE: EffectivePlan = {
  ...PRO,
  slug: "free",
  name: "Free",
  maxMonitors: 1,
  minIntervalSeconds: 300,
  maxChannels: 1,
  allowKeyword: false,
};

describe("monitor quota", () => {
  it("accepts usage below the plan limit", () => {
    expect(() => assertMonitorQuota(PRO, PRO.maxMonitors - 1)).not.toThrow();
  });

  it("rejects usage at and above the limit with the plan named", () => {
    expect(() => assertMonitorQuota(PRO, PRO.maxMonitors)).toThrow(
      QuotaExceededError
    );
    try {
      assertMonitorQuota(PRO, 25);
      throw new Error("expected a quota rejection");
    } catch (error) {
      expect(error).toBeInstanceOf(QuotaExceededError);
      const quota = error as QuotaExceededError;
      expect(quota.code).toBe("QUOTA_EXCEEDED");
      expect(quota.limit).toBe(25);
      expect(quota.planName).toBe("Pro");
      expect(quota.resource).toBe("moniteurs");
    }
  });

  it("uses the singular noun when the limit is one", () => {
    try {
      assertMonitorQuota(FREE, 1);
      throw new Error("expected a quota rejection");
    } catch (error) {
      expect((error as QuotaExceededError).resource).toBe("moniteur");
    }
  });
});

describe("notification channel quota", () => {
  it("counts channels against the plan ceiling", () => {
    expect(() => assertChannelQuota(PRO, 2)).not.toThrow();
    expect(() => assertChannelQuota(PRO, 3)).toThrow(QuotaExceededError);
    try {
      assertChannelQuota(FREE, 1);
      throw new Error("expected a quota rejection");
    } catch (error) {
      expect((error as QuotaExceededError).resource).toBe(
        "canal de notification"
      );
    }
  });
});

describe("plan numeric limits", () => {
  it("rejects an interval shorter than the plan minimum", () => {
    expect(() => assertIntervalAllowed(PRO, 300)).not.toThrow();
    try {
      assertIntervalAllowed(PRO, 60);
      throw new Error("expected a limit rejection");
    } catch (error) {
      expect(error).toBeInstanceOf(PlanLimitError);
      const limit = error as PlanLimitError;
      expect(limit.code).toBe("VALIDATION_ERROR");
      expect(limit.direction).toBe("at_least");
      expect(limit.limit).toBe(300);
      expect(limit.requested).toBe(60);
    }
  });

  it("rejects a timeout longer than the plan ceiling", () => {
    expect(() => assertTimeoutAllowed(PRO, 30_000)).not.toThrow();
    try {
      assertTimeoutAllowed(PRO, 45_000);
      throw new Error("expected a limit rejection");
    } catch (error) {
      expect((error as PlanLimitError).direction).toBe("at_most");
      expect((error as PlanLimitError).resource).toBe("délai d'expiration");
    }
  });
});

describe("feature gating", () => {
  it("refuses content assertions on a plan without them", () => {
    expect(() => assertKeywordAllowed(PRO)).not.toThrow();
    try {
      assertKeywordAllowed(FREE);
      throw new Error("expected a feature rejection");
    } catch (error) {
      expect(error).toBeInstanceOf(FeatureUnavailableError);
      expect((error as FeatureUnavailableError).code).toBe(
        "FEATURE_UNAVAILABLE"
      );
      expect((error as FeatureUnavailableError).feature).toBe(
        "vérification de contenu"
      );
    }
  });
});

type FakeRow = Record<string, unknown>;

/** Minimal chainable stand-in: the service only ever uses select/update fluent APIs. */
function fakeDb(rows: FakeRow[], updates: FakeRow[] = []) {
  const selected: FakeRow[][] = [rows];
  return {
    db: {
      select() {
        return {
          from() {
            return {
              where() {
                return {
                  limit: () => selected.shift() ?? [],
                };
              },
            };
          },
        };
      },
      update() {
        return {
          set(values: FakeRow) {
            updates.push(values);
            return { where: () => [] };
          },
        };
      },
    },
    updates,
  };
}

describe("plan resolution", () => {
  it("reads the assigned plan row", async () => {
    const { db } = fakeDb([
      {
        id: 2,
        slug: "pro",
        name: "Pro",
        maxMonitors: 25,
        minIntervalSeconds: 300,
        maxTimeoutMs: 30_000,
        maxChannels: 3,
        allowKeyword: true,
        priceCents: 900,
        trialDays: 14,
      },
    ]);
    const plan = await resolvePlan(db as never, { id: 7, planId: 2 });
    expect(plan.slug).toBe("pro");
    expect(plan.maxMonitors).toBe(25);
  });

  it("falls back to the built-in free tier when no plan is assigned", async () => {
    const { db } = fakeDb([]);
    const plan = await resolvePlan(db as never, { id: 7, planId: null });
    expect(plan.slug).toBe("free");
    expect(plan.allowKeyword).toBe(false);
  });

  it("re-anchors an account whose plan row was deleted", async () => {
    const { db, updates } = fakeDb([]);
    const plan = await resolvePlan(db as never, { id: 7, planId: 99 });
    expect(plan.slug).toBe("free");
    expect(updates).toEqual([{ planId: null }]);
  });
});
