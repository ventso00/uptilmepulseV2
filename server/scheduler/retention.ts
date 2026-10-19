import { lt, type SQL } from "drizzle-orm";
import { notificationDeliveries, pingLogs, sessions } from "@shared/db/schema";
import type { Database } from "../db";

export const RETENTION = {
  /** UI windows query at most 30 days; 90 keeps a safety margin for audits. */
  pingLogsDays: 90,
  deliveriesDays: 90,
  /** Small batches keep each DELETE short enough to never block a check. */
  batchSize: 1000,
} as const;

export type RetentionCounts = {
  expiredSessions: number;
  pingLogs: number;
  deliveries: number;
};

export function retentionCutoffs(now: Date): {
  pingLogs: Date;
  deliveries: Date;
} {
  return {
    pingLogs: new Date(
      now.getTime() - RETENTION.pingLogsDays * 24 * 60 * 60 * 1000
    ),
    deliveries: new Date(
      now.getTime() - RETENTION.deliveriesDays * 24 * 60 * 60 * 1000
    ),
  };
}

async function deleteBatch(
  db: Database,
  table: typeof sessions | typeof pingLogs | typeof notificationDeliveries,
  where: SQL
): Promise<number> {
  const result = await db
    .delete(table)
    .where(where)
    .limit(RETENTION.batchSize)
    .execute();
  const header = (result as unknown as [{ affectedRows?: number }])[0];
  return header?.affectedRows ?? 0;
}

/**
 * One incremental sweep, meant to be called from the scheduler tick.
 * Deletions are idempotent, so overlapping ticks are harmless.
 */
export async function runRetentionSweep(
  db: Database,
  now = new Date()
): Promise<RetentionCounts> {
  const cutoffs = retentionCutoffs(now);
  return {
    expiredSessions: await deleteBatch(
      db,
      sessions,
      lt(sessions.expiresAt, now)
    ),
    pingLogs: await deleteBatch(
      db,
      pingLogs,
      lt(pingLogs.checkedAt, cutoffs.pingLogs)
    ),
    deliveries: await deleteBatch(
      db,
      notificationDeliveries,
      lt(notificationDeliveries.createdAt, cutoffs.deliveries)
    ),
  };
}
