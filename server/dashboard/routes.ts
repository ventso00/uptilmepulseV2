import { and, desc, eq, inArray } from "drizzle-orm";
import type { Express, Request, Response } from "express";
import { incidents, monitors, pingLogs } from "@shared/db/schema";
import { getDb } from "../db";
import {
  getGlobalUptime,
  getUptimeByMonitor,
  type UptimeStats,
} from "../monitors/stats";
import { asyncHandler, requireUser, sendError } from "../_core/http";

const ANALYTICS_WINDOW_DAYS = 30;
const ACTIVE_INCIDENT_LIMIT = 20;
const RECENT_CHECKS_PER_MONITOR = 30;

function serializeMonitor(
  monitor: typeof monitors.$inferSelect,
  stats?: UptimeStats,
  recentChecks: {
    isUp: boolean;
    statusCode: number | null;
    responseTimeMs: number | null;
    checkedAt: Date;
  }[] = []
) {
  return {
    id: monitor.id,
    name: monitor.name,
    url: monitor.url,
    intervalSeconds: monitor.intervalSeconds,
    timeoutMs: monitor.timeoutMs,
    enabled: monitor.enabled,
    status: monitor.enabled ? monitor.currentStatus : "PAUSED",
    consecutiveFailures: monitor.consecutiveFailures,
    consecutiveSuccesses: monitor.consecutiveSuccesses,
    nextCheckAt: monitor.nextCheckAt,
    lastCheckAt: monitor.lastCheckAt,
    uptimePercent: stats?.uptimePercent ?? null,
    averageResponseTimeMs: stats?.averageResponseTimeMs ?? null,
    latestCheck: stats?.latestLog
      ? {
          statusCode: stats.latestLog.statusCode,
          responseTimeMs: stats.latestLog.responseTimeMs,
          dnsMs: stats.latestLog.dnsMs,
          tcpMs: stats.latestLog.tcpMs,
          tlsMs: stats.latestLog.tlsMs,
          ttfbMs: stats.latestLog.ttfbMs,
          isUp: stats.latestLog.isUp,
          classification: stats.latestLog.classification,
          checkedAt: stats.latestLog.checkedAt,
        }
      : null,
    recentChecks,
    ssl:
      monitor.sslIssuer && monitor.sslSubject
        ? {
            issuer: monitor.sslIssuer,
            subject: monitor.sslSubject,
            validTo: monitor.sslValidTo,
          }
        : null,
  };
}

export function registerDashboardRoutes(app: Express): void {
  app.get(
    "/api/dashboard",
    asyncHandler(async (req: Request, res: Response) => {
      const user = await requireUser(req, res);
      if (!user) return;
      const db = await getDb();
      if (!db)
        return sendError(
          res,
          503,
          "DATABASE_UNAVAILABLE",
          "Service unavailable"
        );

      const monitorRows = await db
        .select()
        .from(monitors)
        .where(eq(monitors.userId, user.id))
        .orderBy(desc(monitors.createdAt));
      const monitorIds = monitorRows.map(row => row.id);
      const since = new Date(
        Date.now() - ANALYTICS_WINDOW_DAYS * 24 * 60 * 60 * 1000
      );

      // All aggregates run in SQL. The previous implementation loaded every
      // ping log of the window into memory to compute two numbers in JS.
      const [perMonitor, globalStats, active, recentLogRows] =
        await Promise.all([
          getUptimeByMonitor(db, monitorIds, since),
          getGlobalUptime(db, monitorIds, since),
          monitorIds.length === 0
            ? Promise.resolve([])
            : db
                .select({ incident: incidents, monitor: monitors })
                .from(incidents)
                .innerJoin(monitors, eq(monitors.id, incidents.monitorId))
                .where(
                  and(
                    eq(monitors.userId, user.id),
                    eq(incidents.status, "confirmed")
                  )
                )
                .orderBy(desc(incidents.startedAt))
                .limit(ACTIVE_INCIDENT_LIMIT),
          monitorIds.length === 0
            ? Promise.resolve([])
            : db
                .select({
                  monitorId: pingLogs.monitorId,
                  isUp: pingLogs.isUp,
                  statusCode: pingLogs.statusCode,
                  responseTimeMs: pingLogs.responseTimeMs,
                  checkedAt: pingLogs.checkedAt,
                })
                .from(pingLogs)
                .where(inArray(pingLogs.monitorId, monitorIds))
                .orderBy(desc(pingLogs.checkedAt))
                .limit(monitorIds.length * RECENT_CHECKS_PER_MONITOR),
        ]);

      // Keep only the newest N checks per monitor, then return them oldest
      // first so the client can render a left-to-right strip.
      const recentByMonitor = new Map<
        number,
        {
          isUp: boolean;
          statusCode: number | null;
          responseTimeMs: number | null;
          checkedAt: Date;
        }[]
      >();
      for (const log of recentLogRows) {
        const list = recentByMonitor.get(log.monitorId) ?? [];
        if (list.length < RECENT_CHECKS_PER_MONITOR) {
          list.push({
            isUp: log.isUp,
            statusCode: log.statusCode,
            responseTimeMs: log.responseTimeMs,
            checkedAt: log.checkedAt,
          });
          recentByMonitor.set(log.monitorId, list);
        }
      }

      res.setHeader("Cache-Control", "private, no-store");
      return res.json({
        summary: {
          totalMonitors: monitorRows.length,
          upMonitors: monitorRows.filter(
            row => row.enabled && row.currentStatus === "UP"
          ).length,
          downMonitors: monitorRows.filter(
            row => row.enabled && row.currentStatus === "DOWN"
          ).length,
          pausedMonitors: monitorRows.filter(row => !row.enabled).length,
          uptimePercent: globalStats.uptimePercent,
          activeIncidents: active.length,
          averageResponseTimeMs: globalStats.averageResponseTimeMs,
        },
        monitors: monitorRows.map(row =>
          serializeMonitor(
            row,
            perMonitor.get(row.id),
            (recentByMonitor.get(row.id) ?? []).reverse()
          )
        ),
        incidents: active.map(row => ({
          ...row.incident,
          monitorName: row.monitor.name,
          monitorUrl: row.monitor.url,
        })),
      });
    })
  );
}
