import { and, count, desc, eq, gte, sql } from "drizzle-orm";
import type { Express, Request, Response } from "express";
import { incidents, monitors, pingLogs } from "@shared/db/schema";
import { getDb } from "../db";
import { consumeRateLimit } from "../auth/rateLimit";
import {
  monitorCreateSchema,
  monitorUpdateSchema,
  periodSchema,
} from "@shared/contracts";
import {
  assertIntervalAllowed,
  assertKeywordAllowed,
  assertMonitorQuota,
  assertTimeoutAllowed,
  resolvePlan,
} from "../plans/service";
import { respondPlanError } from "../plans/respond";
import { runMonitorCheck } from "../checks/engine";
import { TargetValidationError, validateUrlSyntax } from "./ssrf";
import { getUptimeByMonitor, type UptimeStats } from "./stats";
import { asyncHandler, parseId, requireUser, sendError } from "../_core/http";

/** Upper bound on a single history page; the client requests smaller pages. */
const MAX_HISTORY_LIMIT = 500;
const DEFAULT_HISTORY_LIMIT = 240;
const MAX_INCIDENT_LIMIT = 100;

const ANALYTICS_WINDOW_DAYS = 30;

function periodSince(value: string | undefined): Date {
  const period = periodSchema.parse(value ?? "24h");
  const hours = period === "24h" ? 24 : period === "7d" ? 24 * 7 : 24 * 30;
  return new Date(Date.now() - hours * 60 * 60 * 1000);
}

function boundedLimit(
  value: string | undefined,
  fallback: number,
  max: number
): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) return fallback;
  return Math.min(parsed, max);
}

function analyticsSince(): Date {
  return new Date(Date.now() - ANALYTICS_WINDOW_DAYS * 24 * 60 * 60 * 1000);
}

function serializeMonitor(
  monitor: typeof monitors.$inferSelect,
  stats?: UptimeStats
) {
  return {
    id: monitor.id,
    name: monitor.name,
    url: monitor.url,
    intervalSeconds: monitor.intervalSeconds,
    timeoutMs: monitor.timeoutMs,
    keyword: monitor.keyword,
    keywordMode: monitor.keywordMode,
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

function validateTargetOrRespond(res: Response, url: string): boolean {
  try {
    validateUrlSyntax(url);
    return true;
  } catch (error) {
    if (error instanceof TargetValidationError)
      sendError(res, 400, error.code, error.message);
    else sendError(res, 400, "INVALID_TARGET", "URL is invalid");
    return false;
  }
}

function limitMonitorWrites(req: Request, res: Response): boolean {
  const rate = consumeRateLimit(
    `monitor-write:${req.ip ?? "unknown"}`,
    30,
    60_000
  );
  if (rate.allowed) return true;
  sendError(
    res,
    429,
    "RATE_LIMITED",
    "Too many requests",
    rate.retryAfterSeconds
  );
  return false;
}

export function registerMonitorRoutes(app: Express): void {
  app.get(
    "/api/monitors",
    asyncHandler(async (req, res) => {
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
      const rows = await db
        .select()
        .from(monitors)
        .where(eq(monitors.userId, user.id))
        .orderBy(desc(monitors.createdAt));
      const stats = await getUptimeByMonitor(
        db,
        rows.map(row => row.id),
        analyticsSince()
      );
      res.setHeader("Cache-Control", "private, no-store");
      return res.json({
        monitors: rows.map(row => serializeMonitor(row, stats.get(row.id))),
      });
    })
  );

  app.post(
    "/api/monitors",
    asyncHandler(async (req, res) => {
      if (!limitMonitorWrites(req, res)) return;
      const user = await requireUser(req, res);
      if (!user) return;
      const parsed = monitorCreateSchema.safeParse(req.body);
      if (!parsed.success)
        return sendError(
          res,
          400,
          "VALIDATION_ERROR",
          "Monitor fields are invalid"
        );
      if (!validateTargetOrRespond(res, parsed.data.url)) return;

      const db = await getDb();
      if (!db)
        return sendError(
          res,
          503,
          "DATABASE_UNAVAILABLE",
          "Service unavailable"
        );

      const plan = await resolvePlan(db, user);
      const keyword = parsed.data.keyword?.trim() || null;
      try {
        if (keyword) assertKeywordAllowed(plan);
        assertIntervalAllowed(plan, parsed.data.intervalSeconds);
        assertTimeoutAllowed(plan, parsed.data.timeoutMs);
      } catch (error) {
        if (respondPlanError(res, error)) return;
        throw error;
      }

      // The count and the insert share one transaction so two concurrent
      // requests cannot both observe a free slot and exceed the plan limit.
      const created = await db
        .transaction(async tx => {
          const [{ total }] = await tx
            .select({ total: count() })
            .from(monitors)
            .where(eq(monitors.userId, user.id));
          assertMonitorQuota(plan, Number(total));
          const [result] = await tx.insert(monitors).values({
            userId: user.id,
            name: parsed.data.name,
            url: parsed.data.url,
            intervalSeconds: parsed.data.intervalSeconds,
            timeoutMs: parsed.data.timeoutMs,
            keyword,
            keywordMode: parsed.data.keywordMode,
            nextCheckAt: new Date(),
          });
          return tx
            .select()
            .from(monitors)
            .where(eq(monitors.id, Number(result.insertId)))
            .limit(1);
        })
        .catch(error => {
          if (respondPlanError(res, error)) return null;
          throw error;
        });
      if (!created) return;

      const [row] = created;
      return res.status(201).json({ monitor: serializeMonitor(row) });
    })
  );

  app.get(
    "/api/monitors/:id/history",
    asyncHandler(async (req, res) => {
      const user = await requireUser(req, res);
      if (!user) return;
      const id = parseId(req.params.id);
      if (!id)
        return sendError(res, 400, "VALIDATION_ERROR", "Monitor id is invalid");
      const db = await getDb();
      if (!db)
        return sendError(
          res,
          503,
          "DATABASE_UNAVAILABLE",
          "Service unavailable"
        );
      const owned = await db
        .select({ id: monitors.id })
        .from(monitors)
        .where(and(eq(monitors.id, id), eq(monitors.userId, user.id)))
        .limit(1);
      if (!owned[0])
        return sendError(res, 404, "NOT_FOUND", "Monitor not found");
      let since: Date;
      try {
        since = periodSince(
          typeof req.query.period === "string" ? req.query.period : undefined
        );
      } catch {
        return sendError(res, 400, "VALIDATION_ERROR", "Period is invalid");
      }
      const limit = boundedLimit(
        typeof req.query.limit === "string" ? req.query.limit : undefined,
        DEFAULT_HISTORY_LIMIT,
        MAX_HISTORY_LIMIT
      );
      const scope = and(
        eq(pingLogs.monitorId, id),
        gte(pingLogs.checkedAt, since)
      );

      // Paged by keyset rather than OFFSET so deep pages stay cheap, and the
      // total is computed in SQL instead of by materialising every row.
      const cursor = Number(req.query.before);
      const cursorFilter =
        Number.isInteger(cursor) && cursor > 0
          ? and(scope, sql`${pingLogs.id} < ${cursor}`)
          : scope;

      const [rows, totals] = await Promise.all([
        db
          .select()
          .from(pingLogs)
          .where(cursorFilter)
          .orderBy(desc(pingLogs.id))
          .limit(limit + 1),
        db.select({ total: count() }).from(pingLogs).where(scope),
      ]);

      const hasMore = rows.length > limit;
      const page = hasMore ? rows.slice(0, limit) : rows;
      res.setHeader("Cache-Control", "private, no-store");
      return res.json({
        logs: page,
        total: Number(totals[0]?.total ?? 0),
        hasMore,
      });
    })
  );

  app.get(
    "/api/monitors/:id/incidents",
    asyncHandler(async (req, res) => {
      const user = await requireUser(req, res);
      if (!user) return;
      const id = parseId(req.params.id);
      if (!id)
        return sendError(res, 400, "VALIDATION_ERROR", "Monitor id is invalid");
      const db = await getDb();
      if (!db)
        return sendError(
          res,
          503,
          "DATABASE_UNAVAILABLE",
          "Service unavailable"
        );
      const owned = await db
        .select({ id: monitors.id })
        .from(monitors)
        .where(and(eq(monitors.id, id), eq(monitors.userId, user.id)))
        .limit(1);
      if (!owned[0])
        return sendError(res, 404, "NOT_FOUND", "Monitor not found");
      const limit = boundedLimit(
        typeof req.query.limit === "string" ? req.query.limit : undefined,
        25,
        MAX_INCIDENT_LIMIT
      );
      const rows = await db
        .select()
        .from(incidents)
        .where(eq(incidents.monitorId, id))
        .orderBy(desc(incidents.startedAt))
        .limit(limit);
      res.setHeader("Cache-Control", "private, no-store");
      return res.json({ incidents: rows });
    })
  );

  app.get(
    "/api/monitors/:id",
    asyncHandler(async (req, res) => {
      const user = await requireUser(req, res);
      if (!user) return;
      const id = parseId(req.params.id);
      if (!id)
        return sendError(res, 400, "VALIDATION_ERROR", "Monitor id is invalid");
      const db = await getDb();
      if (!db)
        return sendError(
          res,
          503,
          "DATABASE_UNAVAILABLE",
          "Service unavailable"
        );
      const row = await db
        .select()
        .from(monitors)
        .where(and(eq(monitors.id, id), eq(monitors.userId, user.id)))
        .limit(1);
      if (!row[0]) return sendError(res, 404, "NOT_FOUND", "Monitor not found");
      const stats = await getUptimeByMonitor(db, [id], analyticsSince());
      res.setHeader("Cache-Control", "private, no-store");
      return res.json({ monitor: serializeMonitor(row[0], stats.get(id)) });
    })
  );

  app.put(
    "/api/monitors/:id",
    asyncHandler(async (req, res) => {
      if (!limitMonitorWrites(req, res)) return;
      const user = await requireUser(req, res);
      if (!user) return;
      const id = parseId(req.params.id);
      if (!id)
        return sendError(res, 400, "VALIDATION_ERROR", "Monitor id is invalid");
      const parsed = monitorUpdateSchema.safeParse(req.body);
      if (!parsed.success)
        return sendError(
          res,
          400,
          "VALIDATION_ERROR",
          "Monitor fields are invalid"
        );
      if (parsed.data.url && !validateTargetOrRespond(res, parsed.data.url))
        return;
      const db = await getDb();
      if (!db)
        return sendError(
          res,
          503,
          "DATABASE_UNAVAILABLE",
          "Service unavailable"
        );
      // Ownership is part of the UPDATE predicate rather than a prior read, so
      // there is no window between the check and the write.
      const plan = await resolvePlan(db, user);
      try {
        if (parsed.data.keyword?.trim()) assertKeywordAllowed(plan);
        if (parsed.data.intervalSeconds !== undefined)
          assertIntervalAllowed(plan, parsed.data.intervalSeconds);
        if (parsed.data.timeoutMs !== undefined)
          assertTimeoutAllowed(plan, parsed.data.timeoutMs);
      } catch (error) {
        if (respondPlanError(res, error)) return;
        throw error;
      }

      // An absent `keyword` leaves the content rule untouched; an explicit null
      // removes it. Only provided fields are written, so a rename cannot reset
      // the interval or the keyword mode as a side effect.
      const { keyword, keywordMode, name, url, intervalSeconds, timeoutMs } =
        parsed.data;
      const keywordValue = keyword?.trim() || null;
      const patch: Partial<typeof monitors.$inferInsert> = {
        nextCheckAt: new Date(),
      };
      if (name !== undefined) patch.name = name;
      if (url !== undefined) patch.url = url;
      if (intervalSeconds !== undefined)
        patch.intervalSeconds = intervalSeconds;
      if (timeoutMs !== undefined) patch.timeoutMs = timeoutMs;
      if (keyword !== undefined) patch.keyword = keywordValue;
      // The mode only means something while a keyword is set; a mode sent
      // without one is ignored rather than stored against a content-free monitor.
      if (keywordMode !== undefined && keywordValue)
        patch.keywordMode = keywordMode;

      const updated = await db
        .update(monitors)
        .set(patch)
        .where(and(eq(monitors.id, id), eq(monitors.userId, user.id)));
      if (Number(updated[0].affectedRows) === 0)
        return sendError(res, 404, "NOT_FOUND", "Monitor not found");
      const row = await db
        .select()
        .from(monitors)
        .where(eq(monitors.id, id))
        .limit(1);
      return res.json({
        monitor: row[0] ? serializeMonitor(row[0]) : null,
      });
    })
  );

  app.delete(
    "/api/monitors/:id",
    asyncHandler(async (req, res) => {
      if (!limitMonitorWrites(req, res)) return;
      const user = await requireUser(req, res);
      if (!user) return;
      const id = parseId(req.params.id);
      if (!id)
        return sendError(res, 400, "VALIDATION_ERROR", "Monitor id is invalid");
      const db = await getDb();
      if (!db)
        return sendError(
          res,
          503,
          "DATABASE_UNAVAILABLE",
          "Service unavailable"
        );
      const deleted = await db
        .delete(monitors)
        .where(and(eq(monitors.id, id), eq(monitors.userId, user.id)));
      if (Number(deleted[0].affectedRows) === 0)
        return sendError(res, 404, "NOT_FOUND", "Monitor not found");
      return res.status(204).send();
    })
  );

  app.post(
    "/api/monitors/:id/check",
    asyncHandler(async (req, res) => {
      if (!limitMonitorWrites(req, res)) return;
      const user = await requireUser(req, res);
      if (!user) return;
      const id = parseId(req.params.id);
      if (!id)
        return sendError(res, 400, "VALIDATION_ERROR", "Monitor id is invalid");
      const db = await getDb();
      if (!db)
        return sendError(
          res,
          503,
          "DATABASE_UNAVAILABLE",
          "Service unavailable"
        );
      const owned = await db
        .select({ enabled: monitors.enabled })
        .from(monitors)
        .where(and(eq(monitors.id, id), eq(monitors.userId, user.id)))
        .limit(1);
      if (owned.length === 0)
        return sendError(res, 404, "NOT_FOUND", "Monitor not found");
      if (!owned[0].enabled)
        return sendError(
          res,
          409,
          "MONITOR_PAUSED",
          "Reprendre le monitor avant de le vérifier"
        );
      // Force the due time so the engine's atomic claim accepts the check now.
      // A concurrent scheduler claim wins the lease only once: runMonitorCheck
      // returns null for the loser, surfaced here as 409.
      // Truncate to whole seconds first: `nextCheckAt` has second precision and
      // MySQL rounds .5s+ up, which could store the forced date one second in
      // the future and make the claim (`nextCheckAt <= now`) reject its own
      // write with a spurious 409.
      await db
        .update(monitors)
        .set({
          nextCheckAt: new Date(Math.floor(Date.now() / 1000) * 1000 - 1000),
        })
        .where(
          and(
            eq(monitors.id, id),
            eq(monitors.userId, user.id),
            eq(monitors.enabled, true)
          )
        );
      const event = await runMonitorCheck(id);
      if (!event)
        return sendError(
          res,
          409,
          "CHECK_IN_PROGRESS",
          "Un check est déjà en cours pour ce monitor"
        );
      return res.json({
        check: {
          isUp: event.isUp,
          statusCode: event.statusCode,
          responseTimeMs: event.responseTimeMs,
          dnsMs: event.phases?.dnsMs ?? null,
          ttfbMs: event.phases?.ttfbMs ?? null,
          classification: event.classification,
          incidentAction: event.incidentAction,
        },
      });
    })
  );

  for (const [path, enabled] of [
    ["pause", false],
    ["resume", true],
  ] as const) {
    app.post(
      `/api/monitors/:id/${path}`,
      asyncHandler(async (req, res) => {
        if (!limitMonitorWrites(req, res)) return;
        const user = await requireUser(req, res);
        if (!user) return;
        const id = parseId(req.params.id);
        if (!id)
          return sendError(
            res,
            400,
            "VALIDATION_ERROR",
            "Monitor id is invalid"
          );
        const db = await getDb();
        if (!db)
          return sendError(
            res,
            503,
            "DATABASE_UNAVAILABLE",
            "Service unavailable"
          );
        const updated = await db
          .update(monitors)
          .set({
            enabled,
            currentStatus: enabled ? "UNKNOWN" : "PAUSED",
            consecutiveFailures: 0,
            consecutiveSuccesses: 0,
            nextCheckAt: new Date(),
          })
          .where(and(eq(monitors.id, id), eq(monitors.userId, user.id)));
        if (Number(updated[0].affectedRows) === 0)
          return sendError(res, 404, "NOT_FOUND", "Monitor not found");
        const row = await db
          .select()
          .from(monitors)
          .where(eq(monitors.id, id))
          .limit(1);
        return res.json({
          monitor: row[0] ? serializeMonitor(row[0]) : null,
        });
      })
    );
  }
}
