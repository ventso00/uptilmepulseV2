import { eq } from "drizzle-orm";
import { FREE_PLAN } from "@shared/contracts";
import { plans, users, type Plan, type User } from "@shared/db/schema";
import type { Database } from "../db";

/**
 * Plan limits as the enforcement layer sees them. Detached from the row so a
 * missing or deleted plan can be replaced by the built-in free tier instead of
 * locking an account out of its own monitors.
 */
export type EffectivePlan = {
  slug: string;
  name: string;
  maxMonitors: number;
  minIntervalSeconds: number;
  maxTimeoutMs: number;
  maxChannels: number;
  allowKeyword: boolean;
  priceCents: number;
  trialDays: number;
};

const BUILT_IN_FREE: EffectivePlan = {
  slug: "free",
  name: "Free",
  maxMonitors: FREE_PLAN.maxMonitors,
  minIntervalSeconds: FREE_PLAN.minIntervalSeconds,
  maxTimeoutMs: FREE_PLAN.maxTimeoutMs,
  maxChannels: 1,
  allowKeyword: false,
  priceCents: 0,
  trialDays: 0,
};

export class QuotaExceededError extends Error {
  readonly code = "QUOTA_EXCEEDED";

  constructor(
    readonly limit: number,
    readonly planName: string,
    readonly resource: string
  ) {
    super("QUOTA_EXCEEDED");
    this.name = "QuotaExceededError";
  }
}

export class FeatureUnavailableError extends Error {
  readonly code = "FEATURE_UNAVAILABLE";

  constructor(
    readonly feature: string,
    readonly planName: string
  ) {
    super("FEATURE_UNAVAILABLE");
    this.name = "FeatureUnavailableError";
  }
}

/** A numeric limit of the plan was crossed: interval too short, timeout too long. */
export class PlanLimitError extends Error {
  readonly code = "VALIDATION_ERROR";

  constructor(
    readonly resource: string,
    readonly limit: number,
    readonly requested: number,
    readonly direction: "at_least" | "at_most",
    readonly planName: string
  ) {
    super("VALIDATION_ERROR");
    this.name = "PlanLimitError";
  }
}

function toEffective(row: Plan): EffectivePlan {
  return {
    slug: row.slug,
    name: row.name,
    maxMonitors: row.maxMonitors,
    minIntervalSeconds: row.minIntervalSeconds,
    maxTimeoutMs: row.maxTimeoutMs,
    maxChannels: row.maxChannels,
    allowKeyword: row.allowKeyword,
    priceCents: row.priceCents,
    trialDays: row.trialDays,
  };
}

/**
 * An account with no explicit plan sits on `free`; an account whose plan row
 * was deleted falls back to the built-in tier rather than losing access.
 */
export async function resolvePlan(
  db: Database,
  user: Pick<User, "id" | "planId">
): Promise<EffectivePlan> {
  const rows = user.planId
    ? await db.select().from(plans).where(eq(plans.id, user.planId)).limit(1)
    : await db.select().from(plans).where(eq(plans.slug, "free")).limit(1);
  const row = rows[0];
  if (!row) {
    if (!user.planId) return BUILT_IN_FREE;
    // The assigned plan disappeared: re-anchor the account on `free` so the
    // next resolution does not run a doomed lookup on every request.
    await db.update(users).set({ planId: null }).where(eq(users.id, user.id));
    return BUILT_IN_FREE;
  }
  return toEffective(row);
}

export async function findPlanBySlug(
  db: Database,
  slug: string
): Promise<Plan | null> {
  const rows = await db
    .select()
    .from(plans)
    .where(eq(plans.slug, slug))
    .limit(1);
  return rows[0] ?? null;
}

/** French noun phrases need the article-free count to agree with the limit. */
function resourceLabel(
  count: number,
  singular: string,
  plural: string
): string {
  return count === 1 ? singular : plural;
}

export function assertMonitorQuota(
  plan: EffectivePlan,
  currentCount: number
): void {
  if (currentCount >= plan.maxMonitors) {
    throw new QuotaExceededError(
      plan.maxMonitors,
      plan.name,
      resourceLabel(plan.maxMonitors, "moniteur", "moniteurs")
    );
  }
}

export function assertChannelQuota(
  plan: EffectivePlan,
  currentCount: number
): void {
  if (currentCount >= plan.maxChannels) {
    throw new QuotaExceededError(
      plan.maxChannels,
      plan.name,
      resourceLabel(
        plan.maxChannels,
        "canal de notification",
        "canaux de notification"
      )
    );
  }
}

export function assertIntervalAllowed(
  plan: EffectivePlan,
  intervalSeconds: number
): void {
  if (intervalSeconds < plan.minIntervalSeconds) {
    throw new PlanLimitError(
      "intervalle entre deux checks",
      plan.minIntervalSeconds,
      intervalSeconds,
      "at_least",
      plan.name
    );
  }
}

export function assertTimeoutAllowed(
  plan: EffectivePlan,
  timeoutMs: number
): void {
  if (timeoutMs > plan.maxTimeoutMs) {
    throw new PlanLimitError(
      "délai d'expiration",
      plan.maxTimeoutMs,
      timeoutMs,
      "at_most",
      plan.name
    );
  }
}

export function assertKeywordAllowed(plan: EffectivePlan): void {
  if (!plan.allowKeyword) {
    throw new FeatureUnavailableError("vérification de contenu", plan.name);
  }
}
