import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";
import { incidents, monitors, pingLogs, type Monitor } from "@shared/db/schema";
import type { Database } from "../db";
import { RETENTION } from "../scheduler/retention";
import {
  FREE_PLAN,
  INCIDENT_RULES,
  type PublicMonitorStatus,
  type PublicStatusIncident,
  type PublicStatusMethodology,
  type PublicStatusSummary,
  type PublicStatusPayload,
  type StatusCertificate,
  type StatusSla,
  type StatusWindow,
} from "@shared/contracts";

/** Calendar window shown on the page: the full ping-log retention. */
export const STATUS_WINDOW_DAYS = RETENTION.pingLogsDays;

/**
 * Latency and phase statistics use only the most recent checks, so exact
 * percentiles cost a bounded read instead of a 90-day scan. The current 7 days
 * are read together with the previous 7 days, which the trend arrow compares
 * against.
 *
 * The cap is derived from the schema rather than guessed: `intervalSeconds`
 * can never go below 300 s, so a monitor produces at most 288 checks per day
 * and at most 2 × 7 × 288 = 4 032 rows inside the sample window. Adding one
 * day of slack makes truncation provably impossible — the LIMIT is shared
 * across monitors, so a capped budget would otherwise drop the *oldest* rows
 * first and bias the comparison window (and any one chatty monitor could starve
 * the others). A truncated sample would silently publish a trend computed on a
 * handful of checks.
 */
export const LATENCY_WINDOW_DAYS = 7;
const MAX_CHECKS_PER_DAY = (24 * 60 * 60) / FREE_PLAN.minIntervalSeconds;
export const LATENCY_SAMPLE_CAP_PER_MONITOR =
  2 * LATENCY_WINDOW_DAYS * MAX_CHECKS_PER_DAY + MAX_CHECKS_PER_DAY;

/** Published reference point, labelled as an objective in the UI, never a contract. */
export const SLA_TARGET_PERCENT = 99.9;

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

export type SampleRow = {
  monitorId: number;
  checkedAt: Date;
  responseTimeMs: number | null;
  isUp: boolean;
  dnsMs: number | null;
  tcpMs: number | null;
  tlsMs: number | null;
  ttfbMs: number | null;
};

export type MonitorMetrics = Pick<
  PublicMonitorStatus,
  | "days"
  | "windows"
  | "hourly"
  | "latency"
  | "phases"
  | "failures"
  | "incidents"
  | "certificate"
  | "coverage"
  | "sla"
>;

export type PublicStatusAnalysis = {
  summary: PublicStatusSummary;
  methodology: PublicStatusMethodology;
  incidents: PublicStatusIncident[];
  /** One entry per monitor, in the same order as the `monitorRows` argument. */
  monitors: MonitorMetrics[];
};

function round2(value: number): number {
  return Number(value.toFixed(2));
}

function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return Math.round(
    values.reduce((sum, value) => sum + value, 0) / values.length
  );
}

/**
 * Nearest-rank percentile over an ascending list: exact on the sample, no
 * histogram approximation, so the figure can be reproduced from raw checks.
 */
export function percentile(sorted: number[], quantile: number): number | null {
  if (sorted.length === 0) return null;
  const rank = Math.ceil((quantile / 100) * sorted.length);
  return sorted[Math.min(sorted.length - 1, Math.max(0, rank - 1))] ?? null;
}

export function windowFromCounts(up: number, total: number): StatusWindow {
  return {
    uptimePercent: total === 0 ? null : round2((up / total) * 100),
    totalChecks: total,
    failedChecks: total - up,
  };
}

/**
 * Consecutive UTC-hour buckets, oldest first. Hours without a check are kept as
 * zeroes: an absent bar must mean "no check yet", never "this service was down".
 */
export function buildHourlyBuckets(
  rows: SampleRow[],
  endTime: Date,
  hours: number
): PublicMonitorStatus["hourly"] {
  const lastHourStart = Math.floor(endTime.getTime() / HOUR_MS) * HOUR_MS;
  const start = lastHourStart - (hours - 1) * HOUR_MS;
  const buckets = Array.from({ length: hours }, (_, index) => ({
    time: new Date(start + index * HOUR_MS).toISOString(),
    up: 0,
    down: 0,
    timings: [] as number[],
  }));
  for (const row of rows) {
    const hourStart = Math.floor(row.checkedAt.getTime() / HOUR_MS) * HOUR_MS;
    const index = Math.round((hourStart - start) / HOUR_MS);
    if (index < 0 || index >= hours) continue;
    const bucket = buckets[index];
    if (row.isUp) {
      bucket.up += 1;
      if (row.responseTimeMs !== null) bucket.timings.push(row.responseTimeMs);
    } else {
      bucket.down += 1;
    }
  }
  return buckets.map(({ time, up, down, timings }) => ({
    time,
    up,
    down,
    averageMs: mean(timings),
    samples: up + down,
  }));
}

/**
 * Error budget against the published target, derived only from measured checks.
 * Both fields stay null when the window holds no data, so a brand-new service
 * never shows a fabricated budget.
 */
export function errorBudget(input: {
  uptimePercent: number | null;
  windowDays: number;
  targetPercent?: number;
}): StatusSla {
  const target = input.targetPercent ?? SLA_TARGET_PERCENT;
  const base: StatusSla = {
    targetPercent: target,
    windowDays: input.windowDays,
    errorBudgetMinutes: null,
    consumedMinutes: null,
  };
  if (input.uptimePercent === null) return base;
  const windowMinutes = input.windowDays * 24 * 60;
  const allowed = (windowMinutes * (100 - target)) / 100;
  const consumed = (windowMinutes * (100 - input.uptimePercent)) / 100;
  return {
    ...base,
    errorBudgetMinutes: round2(Math.max(0, allowed - consumed)),
    consumedMinutes: round2(Math.min(allowed, consumed)),
  };
}

export function certificateFrom(
  monitor: Monitor,
  now: Date
): StatusCertificate | null {
  if (!monitor.sslValidTo || !monitor.sslIssuer || !monitor.sslSubject)
    return null;
  return {
    issuer: monitor.sslIssuer,
    subject: monitor.sslSubject,
    validTo: monitor.sslValidTo.toISOString(),
    daysRemaining: Math.floor(
      (monitor.sslValidTo.getTime() - now.getTime()) / DAY_MS
    ),
  };
}

function methodologyBlock(): PublicStatusMethodology {
  return {
    failureThreshold: INCIDENT_RULES.failureThreshold,
    recoveryThreshold: INCIDENT_RULES.recoveryThreshold,
    retentionDays: STATUS_WINDOW_DAYS,
    windowDays: STATUS_WINDOW_DAYS,
    latencySampleWindowDays: LATENCY_WINDOW_DAYS,
    latencySampleCap: LATENCY_SAMPLE_CAP_PER_MONITOR,
    minIntervalSeconds: FREE_PLAN.minIntervalSeconds,
    measuredPhases: ["DNS", "TCP", "TLS", "TTFB", "serveur"],
  };
}

function emptySummary(): PublicStatusSummary {
  return {
    services: 0,
    pausedServices: 0,
    checks24h: 0,
    globalUptimePercent: null,
    globalMedianLatencyMs: null,
    incidents90d: 0,
    downtime90dSeconds: 0,
    activeIncidents: 0,
    certificatesExpiringSoon: 0,
  };
}

function toNumber(value: unknown): number {
  return value === null || value === undefined ? 0 : Number(value);
}

function toNullableNumber(value: unknown): number | null {
  return value === null || value === undefined ? null : Number(value);
}

/**
 * Builds every public metric from six grouped queries run in parallel.
 *
 * Not per-monitor on purpose: a three-service page would otherwise issue ~18
 * round trips per request, and the endpoint is public with only a 30 s cache.
 */
export async function buildPublicStatusAnalysis(
  db: Database,
  monitorRows: Monitor[],
  now: Date
): Promise<PublicStatusAnalysis> {
  const monitorIds = monitorRows.map(row => row.id);
  if (monitorIds.length === 0)
    return {
      summary: emptySummary(),
      methodology: methodologyBlock(),
      incidents: [],
      monitors: [],
    };

  const windowStart = new Date(now.getTime() - STATUS_WINDOW_DAYS * DAY_MS);
  const sampleStart = new Date(
    now.getTime() - LATENCY_WINDOW_DAYS * 2 * DAY_MS
  );
  const cutoffs = {
    d1: new Date(now.getTime() - DAY_MS),
    d7: new Date(now.getTime() - LATENCY_WINDOW_DAYS * DAY_MS),
    d30: new Date(now.getTime() - 30 * DAY_MS),
  };
  const upSince = (since: Date) =>
    sql<number>`sum(case when ${pingLogs.checkedAt} >= ${since} and ${pingLogs.isUp} then 1 else 0 end)`;
  const allSince = (since: Date) =>
    sql<number>`sum(case when ${pingLogs.checkedAt} >= ${since} then 1 else 0 end)`;

  const [dayRows, windowRows, sampleRows, failureRows, incidentRows, timeline] =
    await Promise.all([
      db
        .select({
          monitorId: pingLogs.monitorId,
          // date_format keeps MySQL from handing back a TIMESTAMP as a bare
          // "YYYY-MM-DD HH:MM:SS" string, which JS would parse as local time.
          day: sql<string>`date_format(${pingLogs.checkedAt}, '%Y-%m-%d')`.as(
            "check_day"
          ),
          up: upSince(windowStart),
          total: allSince(windowStart),
        })
        .from(pingLogs)
        .where(
          and(
            inArray(pingLogs.monitorId, monitorIds),
            gte(pingLogs.checkedAt, windowStart)
          )
        )
        .groupBy(
          pingLogs.monitorId,
          sql`date_format(${pingLogs.checkedAt}, '%Y-%m-%d')`
        ),

      db
        .select({
          monitorId: pingLogs.monitorId,
          up1: upSince(cutoffs.d1),
          total1: allSince(cutoffs.d1),
          up7: upSince(cutoffs.d7),
          total7: allSince(cutoffs.d7),
          up30: upSince(cutoffs.d30),
          total30: allSince(cutoffs.d30),
          up90: upSince(windowStart),
          total90: allSince(windowStart),
        })
        .from(pingLogs)
        .where(
          and(
            inArray(pingLogs.monitorId, monitorIds),
            gte(pingLogs.checkedAt, windowStart)
          )
        )
        .groupBy(pingLogs.monitorId),

      db
        .select({
          monitorId: pingLogs.monitorId,
          checkedAt: pingLogs.checkedAt,
          responseTimeMs: pingLogs.responseTimeMs,
          isUp: pingLogs.isUp,
          dnsMs: pingLogs.dnsMs,
          tcpMs: pingLogs.tcpMs,
          tlsMs: pingLogs.tlsMs,
          ttfbMs: pingLogs.ttfbMs,
        })
        .from(pingLogs)
        .where(
          and(
            inArray(pingLogs.monitorId, monitorIds),
            gte(pingLogs.checkedAt, sampleStart)
          )
        )
        .orderBy(desc(pingLogs.checkedAt))
        .limit(LATENCY_SAMPLE_CAP_PER_MONITOR * monitorIds.length),

      db
        .select({
          monitorId: pingLogs.monitorId,
          classification: pingLogs.classification,
          count: sql<number>`count(*)`,
        })
        .from(pingLogs)
        .where(
          and(
            inArray(pingLogs.monitorId, monitorIds),
            gte(pingLogs.checkedAt, windowStart),
            eq(pingLogs.isUp, false)
          )
        )
        .groupBy(pingLogs.monitorId, pingLogs.classification),

      db
        .select({
          monitorId: incidents.monitorId,
          confirmed: sql<number>`count(*)`,
          resolved: sql<number>`sum(case when ${incidents.resolvedAt} is not null then 1 else 0 end)`,
          downSeconds: sql<number | null>`sum(${incidents.durationSeconds})`,
          longestDownSeconds: sql<
            number | null
          >`max(${incidents.durationSeconds})`,
        })
        .from(incidents)
        .where(
          and(
            inArray(incidents.monitorId, monitorIds),
            gte(incidents.startedAt, windowStart),
            sql`${incidents.status} <> 'suspect'`
          )
        )
        .groupBy(incidents.monitorId),

      db
        .select({
          id: incidents.id,
          monitorId: incidents.monitorId,
          monitorName: monitors.name,
          status: incidents.status,
          startedAt: incidents.startedAt,
          confirmedAt: incidents.confirmedAt,
          resolvedAt: incidents.resolvedAt,
          durationSeconds: incidents.durationSeconds,
          reason: incidents.reason,
        })
        .from(incidents)
        .innerJoin(monitors, eq(monitors.id, incidents.monitorId))
        .where(
          and(
            inArray(incidents.monitorId, monitorIds),
            gte(incidents.startedAt, windowStart),
            sql`${incidents.status} <> 'suspect'`
          )
        )
        .orderBy(desc(incidents.startedAt))
        .limit(40),
    ]);

  const daysByMonitor = new Map<
    number,
    { date: string; up: number; down: number }[]
  >();
  for (const row of dayRows) {
    const up = toNumber(row.up);
    const list = daysByMonitor.get(row.monitorId) ?? [];
    list.push({ date: row.day, up, down: toNumber(row.total) - up });
    daysByMonitor.set(row.monitorId, list);
  }

  const windowByMonitor = new Map(windowRows.map(row => [row.monitorId, row]));
  const failureByMonitor = new Map<number, PublicMonitorStatus["failures"]>();
  for (const row of failureRows) {
    const list = failureByMonitor.get(row.monitorId) ?? [];
    list.push({
      classification: row.classification,
      count: toNumber(row.count),
    });
    failureByMonitor.set(row.monitorId, list);
  }
  const incidentByMonitor = new Map(
    incidentRows.map(row => [row.monitorId, row])
  );

  const sampleByMonitor = new Map<number, SampleRow[]>();
  for (const row of sampleRows as SampleRow[]) {
    const list = sampleByMonitor.get(row.monitorId) ?? [];
    list.push(row);
    sampleByMonitor.set(row.monitorId, list);
  }

  const metrics: MonitorMetrics[] = [];
  // `timeline` is ordered by startedAt desc, so the first row per monitor id is
  // its most recent incident.
  const lastIncidentByMonitor = new Map<number, Date>();
  for (const row of timeline) {
    if (!lastIncidentByMonitor.has(row.monitorId))
      lastIncidentByMonitor.set(row.monitorId, row.startedAt);
  }
  const timingsFor = (rows: SampleRow[], from: number, to: number) =>
    rows
      .filter(
        row =>
          row.isUp &&
          row.responseTimeMs !== null &&
          row.checkedAt.getTime() >= from &&
          row.checkedAt.getTime() < to
      )
      .map(row => row.responseTimeMs as number);

  let checks24h = 0;
  let totalChecks90 = 0;
  let totalUp90 = 0;
  let downtime90dSeconds = 0;
  let incidents90d = 0;
  let certificatesExpiringSoon = 0;
  let pausedServices = 0;
  const allTimings: number[] = [];

  for (const monitor of monitorRows) {
    const window = windowByMonitor.get(monitor.id);
    const windows = {
      d1: windowFromCounts(toNumber(window?.up1), toNumber(window?.total1)),
      d7: windowFromCounts(toNumber(window?.up7), toNumber(window?.total7)),
      d30: windowFromCounts(toNumber(window?.up30), toNumber(window?.total30)),
      d90: windowFromCounts(toNumber(window?.up90), toNumber(window?.total90)),
    };

    const samples = sampleByMonitor.get(monitor.id) ?? [];
    const currentFrom = cutoffs.d7.getTime();
    const previousFrom = sampleStart.getTime();
    const current = samples.filter(
      row => row.checkedAt.getTime() >= currentFrom
    );
    const timings = timingsFor(samples, currentFrom, now.getTime()).sort(
      (a, b) => a - b
    );
    const previousTimings = timingsFor(samples, previousFrom, currentFrom);
    const averageMs = mean(timings);
    const previousAverageMs = mean(previousTimings);

    const phaseAverage = (field: "dnsMs" | "tcpMs" | "tlsMs" | "ttfbMs") =>
      mean(
        current
          .filter(row => row.isUp && row[field] !== null)
          .map(row => row[field] as number)
      );
    // Each phase mean only averages the rows that actually carry that column,
    // so the published sample size must be measured the same way. Otherwise a
    // monitor with history from before the phase migration would advertise more
    // samples than the mean is built on.
    const phaseSamples = current.filter(
      row => row.isUp && row.ttfbMs !== null
    ).length;
    const dnsMs = phaseAverage("dnsMs");
    const tcpMs = phaseAverage("tcpMs");
    const tlsMs = phaseAverage("tlsMs");
    const ttfbMs = phaseAverage("ttfbMs");
    // TTFB runs from socket start to first byte, so it already contains DNS,
    // TCP and TLS: what is left over is time spent by the remote application.
    const serverMs =
      ttfbMs === null
        ? null
        : Math.max(0, ttfbMs - (dnsMs ?? 0) - (tcpMs ?? 0) - (tlsMs ?? 0));

    const certificate = certificateFrom(monitor, now);
    const incidentRow = incidentByMonitor.get(monitor.id);
    const lastIncident = lastIncidentByMonitor.get(monitor.id);
    const confirmedCount = toNumber(incidentRow?.confirmed);
    const resolvedCount = toNumber(incidentRow?.resolved);
    const downSeconds = toNullableNumber(incidentRow?.downSeconds);

    checks24h += windows.d1.totalChecks;
    totalChecks90 += windows.d90.totalChecks;
    totalUp90 += windows.d90.totalChecks - windows.d90.failedChecks;
    downtime90dSeconds += downSeconds ?? 0;
    incidents90d += confirmedCount;
    allTimings.push(...timings);
    if (certificate && certificate.daysRemaining <= 30)
      certificatesExpiringSoon += 1;
    if (!monitor.enabled) pausedServices += 1;

    metrics.push({
      days: (daysByMonitor.get(monitor.id) ?? []).sort((a, b) =>
        a.date < b.date ? -1 : 1
      ),
      windows,
      hourly: buildHourlyBuckets(current, now, LATENCY_WINDOW_DAYS * 24),
      latency: {
        windowDays: LATENCY_WINDOW_DAYS,
        sampleChecks: timings.length,
        averageMs,
        p50Ms: percentile(timings, 50),
        p90Ms: percentile(timings, 90),
        p95Ms: percentile(timings, 95),
        maxMs: timings.length === 0 ? null : timings[timings.length - 1],
        previousAverageMs,
        trendPercent:
          averageMs === null ||
          previousAverageMs === null ||
          previousAverageMs === 0
            ? null
            : round2(
                ((averageMs - previousAverageMs) / previousAverageMs) * 100
              ),
      },
      phases: {
        windowDays: LATENCY_WINDOW_DAYS,
        sampleChecks: phaseSamples,
        dnsMs,
        tcpMs,
        tlsMs,
        ttfbMs,
        serverMs,
      },
      failures: (failureByMonitor.get(monitor.id) ?? [])
        .slice()
        .sort((a, b) => b.count - a.count)
        .slice(0, 6),
      incidents: {
        windowDays: STATUS_WINDOW_DAYS,
        confirmedCount,
        resolvedCount,
        totalDowntimeSeconds: downSeconds,
        averageDownSeconds:
          downSeconds !== null && resolvedCount > 0
            ? Math.round(downSeconds / resolvedCount)
            : null,
        longestDownSeconds: toNullableNumber(incidentRow?.longestDownSeconds),
        lastIncidentAt: lastIncident ? lastIncident.toISOString() : null,
      },
      certificate,
      coverage: {
        intervalSeconds: monitor.intervalSeconds,
        timeoutMs: monitor.timeoutMs,
        totalChecks: windows.d90.totalChecks,
        lastCheckAt: monitor.lastCheckAt
          ? monitor.lastCheckAt.toISOString()
          : null,
        nextCheckAt: monitor.enabled ? monitor.nextCheckAt.toISOString() : null,
      },
      sla: errorBudget({
        uptimePercent: windows.d90.uptimePercent,
        windowDays: STATUS_WINDOW_DAYS,
      }),
    });
  }

  // The chronology carries the incident still open right now, so the page can
  // show how long it has lasted rather than a bare "un incident en cours".
  const timelineOut: PublicStatusIncident[] = timeline.map(row => ({
    id: row.id,
    monitorName: row.monitorName,
    status: row.status,
    startedAt: row.startedAt.toISOString(),
    confirmedAt: row.confirmedAt ? row.confirmedAt.toISOString() : null,
    resolvedAt: row.resolvedAt ? row.resolvedAt.toISOString() : null,
    durationSeconds: row.durationSeconds,
    elapsedSeconds:
      row.status === "confirmed" && !row.resolvedAt
        ? Math.max(
            0,
            Math.round((now.getTime() - row.startedAt.getTime()) / 1000)
          )
        : null,
    reason: row.reason,
  }));

  return {
    summary: {
      services: monitorRows.length,
      pausedServices,
      checks24h,
      globalUptimePercent:
        totalChecks90 === 0 ? null : round2((totalUp90 / totalChecks90) * 100),
      globalMedianLatencyMs: percentile(
        allTimings.sort((a, b) => a - b),
        50
      ),
      incidents90d,
      downtime90dSeconds,
      activeIncidents: timelineOut.filter(
        row => row.status === "confirmed" && !row.resolvedAt
      ).length,
      certificatesExpiringSoon,
    },
    methodology: methodologyBlock(),
    incidents: timelineOut,
    monitors: metrics,
  };
}

/**
 * The exact body `GET /api/public/status/:slug` answers with. It lives next to
 * the analysis it wraps so the daily functional test can validate the published
 * contract through the same code path the live endpoint uses — a payload change
 * that breaks the shared zod schema has to fail that test, not the page.
 */
export async function buildPublicStatusPayload(
  db: Database,
  page: { userId: number; title: string; description: string | null },
  now: Date
): Promise<PublicStatusPayload> {
  const monitorRows = await db
    .select()
    .from(monitors)
    .where(eq(monitors.userId, page.userId))
    .orderBy(desc(monitors.createdAt));

  const analysis = await buildPublicStatusAnalysis(db, monitorRows, now);
  const anyDown = monitorRows.some(
    row => row.enabled && row.currentStatus === "DOWN"
  );

  return {
    title: page.title,
    description: page.description,
    overall:
      monitorRows.length === 0 ? "empty" : anyDown ? "outage" : "operational",
    days: analysis.methodology.windowDays,
    summary: analysis.summary,
    methodology: analysis.methodology,
    monitors: monitorRows.map((row, index) => ({
      id: row.id,
      name: row.name,
      url: row.url,
      status: row.enabled ? row.currentStatus : "PAUSED",
      ...analysis.monitors[index],
      uptimePercent: analysis.monitors[index].windows.d90.uptimePercent,
      nextCheckAt: row.enabled ? row.nextCheckAt : null,
    })),
    incidents: analysis.incidents,
    generatedAt: now,
  };
}
