import { and, count, eq, gte, inArray, sql } from "drizzle-orm";
import { pingLogs } from "@shared/db/schema";
import type { Database } from "../db";
import type { CheckClassification } from "@shared/db/schema";

export type { Database };

export type UptimeStats = {
  totalChecks: number;
  successfulChecks: number;
  uptimePercent: number | null;
  averageResponseTimeMs: number | null;
  latestLog: typeof pingLogs.$inferSelect | null;
};

export function calculateUptime(
  logs: Array<typeof pingLogs.$inferSelect>
): UptimeStats {
  const totalChecks = logs.length;
  const successfulChecks = logs.filter(log => log.isUp).length;
  const responseTimes = logs.flatMap(log =>
    log.responseTimeMs === null ? [] : [log.responseTimeMs]
  );
  const ordered = [...logs].sort(
    (a, b) => b.checkedAt.getTime() - a.checkedAt.getTime()
  );
  return {
    totalChecks,
    successfulChecks,
    uptimePercent:
      totalChecks === 0
        ? null
        : Number(((successfulChecks / totalChecks) * 100).toFixed(2)),
    averageResponseTimeMs:
      responseTimes.length === 0
        ? null
        : Math.round(
            responseTimes.reduce((sum, value) => sum + value, 0) /
              responseTimes.length
          ),
    latestLog: ordered[0] ?? null,
  };
}

type AggregateRow = {
  monitorId: number;
  totalChecks: number;
  successfulChecks: number;
  averageResponseTimeMs: number | null;
};

/**
 * Aggregates uptime in SQL instead of pulling every ping log into memory.
 * A 30-day window at the 5-minute free-plan interval is ~8.6k rows per monitor,
 * which made the dashboard scale linearly with history.
 */
async function aggregateUptime(
  db: Database,
  monitorIds: number[],
  since: Date
): Promise<Map<number, AggregateRow>> {
  if (monitorIds.length === 0) return new Map();
  const rows = await db
    .select({
      monitorId: pingLogs.monitorId,
      totalChecks: count(),
      successfulChecks: sql<number>`sum(case when ${pingLogs.isUp} then 1 else 0 end)`,
      averageResponseTimeMs: sql<
        number | null
      >`avg(${pingLogs.responseTimeMs})`,
    })
    .from(pingLogs)
    .where(
      and(
        inArray(pingLogs.monitorId, monitorIds),
        gte(pingLogs.checkedAt, since)
      )
    )
    .groupBy(pingLogs.monitorId);

  return new Map(
    rows.map(row => [
      row.monitorId,
      {
        monitorId: row.monitorId,
        totalChecks: Number(row.totalChecks ?? 0),
        successfulChecks: Number(row.successfulChecks ?? 0),
        averageResponseTimeMs:
          row.averageResponseTimeMs === null
            ? null
            : Math.round(Number(row.averageResponseTimeMs)),
      },
    ])
  );
}

/**
 * Latest check per monitor via a grouped max joined in SQL rather than
 * round-tripping the timestamp through JS: MySQL returns `max()` over a
 * TIMESTAMP as a bare "YYYY-MM-DD HH:MM:SS" string which parses as *local*
 * time, while the pool pins sessions to UTC — so matching the parsed Date
 * back against `checkedAt` silently returned no rows. The join also keeps
 * ONLY_FULL_GROUP_BY happy because non-aggregated columns come from the
 * joined table, not the grouped one.
 */
async function latestCheckByMonitor(
  db: Database,
  monitorIds: number[]
): Promise<Map<number, typeof pingLogs.$inferSelect>> {
  if (monitorIds.length === 0) return new Map();
  const latest = db
    .select({
      monitorId: pingLogs.monitorId,
      maxCheckedAt: sql`max(${pingLogs.checkedAt})`.as("max_checked_at"),
    })
    .from(pingLogs)
    .where(inArray(pingLogs.monitorId, monitorIds))
    .groupBy(pingLogs.monitorId)
    .as("latest_checks");

  const rows = await db
    .select({ log: pingLogs })
    .from(pingLogs)
    .innerJoin(
      latest,
      and(
        eq(pingLogs.monitorId, latest.monitorId),
        eq(pingLogs.checkedAt, latest.maxCheckedAt)
      )
    );

  const result = new Map<number, typeof pingLogs.$inferSelect>();
  for (const { log } of rows) {
    const current = result.get(log.monitorId);
    // Two logs can share the same checkedAt; the newer insert wins.
    if (!current || log.id > current.id) result.set(log.monitorId, log);
  }
  return result;
}

export async function getUptimeByMonitor(
  db: Database,
  monitorIds: number[],
  since: Date
): Promise<Map<number, UptimeStats>> {
  if (monitorIds.length === 0) return new Map();
  const [aggregates, latest] = await Promise.all([
    aggregateUptime(db, monitorIds, since),
    latestCheckByMonitor(db, monitorIds),
  ]);
  return new Map(
    monitorIds.map(id => {
      const aggregate = aggregates.get(id);
      const totalChecks = aggregate?.totalChecks ?? 0;
      return [
        id,
        {
          totalChecks,
          successfulChecks: aggregate?.successfulChecks ?? 0,
          uptimePercent:
            totalChecks === 0
              ? null
              : Number(
                  (
                    ((aggregate?.successfulChecks ?? 0) / totalChecks) *
                    100
                  ).toFixed(2)
                ),
          averageResponseTimeMs: aggregate?.averageResponseTimeMs ?? null,
          latestLog: latest.get(id) ?? null,
        },
      ];
    })
  );
}

/** Uptime across every monitor owned by a user, computed server-side. */
export async function getGlobalUptime(
  db: Database,
  monitorIds: number[],
  since: Date
): Promise<{
  uptimePercent: number | null;
  averageResponseTimeMs: number | null;
}> {
  const aggregates = await aggregateUptime(db, monitorIds, since);
  let totalChecks = 0;
  let successfulChecks = 0;
  let responseSum = 0;
  let responseCount = 0;
  for (const aggregate of aggregates.values()) {
    totalChecks += aggregate.totalChecks;
    successfulChecks += aggregate.successfulChecks;
    if (aggregate.averageResponseTimeMs !== null) {
      responseSum += aggregate.averageResponseTimeMs * aggregate.totalChecks;
      responseCount += aggregate.totalChecks;
    }
  }
  return {
    uptimePercent:
      totalChecks === 0
        ? null
        : Number(((successfulChecks / totalChecks) * 100).toFixed(2)),
    averageResponseTimeMs:
      responseCount === 0 ? null : Math.round(responseSum / responseCount),
  };
}

export type { CheckClassification };
