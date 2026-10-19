import { and, desc, eq } from "drizzle-orm";
import { qaRuns, type QaRun } from "@shared/db/schema";
import type { Database } from "../db";
import type { QaRunStatus } from "@shared/contracts";

export type QaRunKind = "self_test" | "daily_digest";

/**
 * Idempotency ledger shared by the recurring QA jobs.
 *
 * The claim is the unique `(kind, periodKey)` insert: with several server
 * instances or an external cron, exactly one pass wins a given period and the
 * others skip. A crash after the claim is still visible because `finishedAt`
 * stays null.
 */
export async function claimRun(
  db: Database,
  kind: QaRunKind,
  periodKey: string
): Promise<QaRun | null> {
  try {
    await db.insert(qaRuns).values({ kind, periodKey });
  } catch (error) {
    if ((error as { code?: string }).code === "ER_DUP_ENTRY") return null;
    throw error;
  }
  const rows = await db
    .select()
    .from(qaRuns)
    .where(and(eq(qaRuns.kind, kind), eq(qaRuns.periodKey, periodKey)))
    .limit(1);
  return rows[0] ?? null;
}

export async function finishRun(
  db: Database,
  runId: number,
  outcome: { status: QaRunStatus; summary: string; detail: string }
): Promise<void> {
  await db
    .update(qaRuns)
    .set({
      status: outcome.status,
      summary: outcome.summary.slice(0, 500),
      detail: outcome.detail,
      finishedAt: new Date(),
    })
    .where(eq(qaRuns.id, runId));
}

export async function latestRun(
  db: Database,
  kind: QaRunKind
): Promise<QaRun | null> {
  const rows = await db
    .select()
    .from(qaRuns)
    .where(eq(qaRuns.kind, kind))
    // `periodKey` is a zero-padded UTC string, so lexical order is time order
    // and the (kind, periodKey) unique index already covers the sort.
    .orderBy(desc(qaRuns.periodKey))
    .limit(1);
  return rows[0] ?? null;
}

export function parseDetail<T>(detail: string | null): T[] {
  if (!detail) return [];
  try {
    const parsed: unknown = JSON.parse(detail);
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}
