import { and, eq, lte } from "drizzle-orm";
import { incidents, monitors, pingLogs } from "@shared/db/schema";
import { getDb } from "../db";
import { performHttpCheck, type CheckPhases } from "./client";
import { decideIncidentTransition } from "../incidents/state";
import { dispatchIncidentNotification } from "../notifications/dispatcher";

export type CheckEvent = {
  monitorId: number;
  classification: string;
  isUp: boolean;
  incidentAction: "none" | "failure" | "recovery";
  incidentId: number | null;
  /** Context needed to format a notification after the transaction commits. */
  userId: number;
  monitorName: string;
  monitorUrl: string;
  statusCode: number | null;
  responseTimeMs: number | null;
  phases: CheckPhases | null;
  detectedAt: Date;
  durationSeconds: number | null;
};

export async function runMonitorCheck(
  monitorId: number
): Promise<CheckEvent | null> {
  const db = await getDb();
  if (!db) throw new Error("Database is not available");
  // Every check can block for the monitor timeout, so the scheduler runs these
  // through a bounded pool. A hung check must never stall the whole batch.
  const work = await runCheck(db, monitorId);
  if (!work) return null;

  if (work.incidentAction !== "none" && work.incidentId) {
    // Deliberately not awaited: notification delivery involves up to three
    // Telegram round-trips per channel and would otherwise hold the scheduler
    // slot for the whole duration. Delivery rows are persisted first, so the
    // periodic retry pass picks up anything that fails here.
    void dispatchIncidentNotification({
      userId: work.userId,
      incidentId: work.incidentId,
      type: work.incidentAction,
      monitorName: work.monitorName,
      monitorUrl: work.monitorUrl,
      statusCode: work.statusCode,
      responseTimeMs: work.responseTimeMs,
      classification: work.classification,
      detectedAt: work.detectedAt,
      durationSeconds: work.durationSeconds,
    }).catch(error => {
      console.error(
        JSON.stringify({
          event: "notification_dispatch_failed",
          incidentId: work.incidentId,
          message: error instanceof Error ? error.message : "unknown error",
        })
      );
    });
  }

  console.log(
    JSON.stringify({
      event: "monitor_check",
      monitorId: work.monitorId,
      classification: work.classification,
      isUp: work.isUp,
      responseTimeMs: work.responseTimeMs,
      incidentAction: work.incidentAction,
    })
  );
  if (work.incidentAction === "failure")
    console.log(
      JSON.stringify({
        event: "incident_confirmed",
        monitorId: work.monitorId,
        incidentId: work.incidentId,
      })
    );
  if (work.incidentAction === "recovery")
    console.log(
      JSON.stringify({
        event: "incident_resolved",
        monitorId: work.monitorId,
        incidentId: work.incidentId,
        durationSeconds: work.durationSeconds,
      })
    );
  return work;
}

async function runCheck(
  db: NonNullable<Awaited<ReturnType<typeof getDb>>>,
  monitorId: number
): Promise<CheckEvent | null> {
  const claimUntil = new Date(Date.now() + 6 * 60 * 1000);
  const claimed = await db
    .update(monitors)
    .set({ nextCheckAt: claimUntil })
    .where(
      and(
        eq(monitors.id, monitorId),
        eq(monitors.enabled, true),
        lte(monitors.nextCheckAt, new Date())
      )
    );
  if (Number(claimed[0].affectedRows) === 0) return null;
  const current = await db
    .select()
    .from(monitors)
    .where(eq(monitors.id, monitorId))
    .limit(1);
  const monitor = current[0];
  if (!monitor || !monitor.enabled) return null;

  const result = await performHttpCheck(
    monitor.url,
    monitor.timeoutMs,
    monitor.keyword
      ? {
          keyword: monitor.keyword,
          mustContain: monitor.keywordMode === "must_contain",
        }
      : null
  );
  const checkedAt = new Date();

  const event = await db.transaction(async tx => {
    const activeIncident = await tx
      .select()
      .from(incidents)
      .where(
        and(
          eq(incidents.monitorId, monitor.id),
          eq(incidents.status, "confirmed")
        )
      )
      .limit(1);
    const suspectIncident = await tx
      .select()
      .from(incidents)
      .where(
        and(
          eq(incidents.monitorId, monitor.id),
          eq(incidents.status, "suspect")
        )
      )
      .limit(1);
    const active = activeIncident[0] ?? suspectIncident[0];
    const [logInsert] = await tx.insert(pingLogs).values({
      monitorId: monitor.id,
      statusCode: result.statusCode,
      responseTimeMs: result.responseTimeMs,
      dnsMs: result.phases?.dnsMs ?? null,
      tcpMs: result.phases?.tcpMs ?? null,
      tlsMs: result.phases?.tlsMs ?? null,
      ttfbMs: result.phases?.ttfbMs ?? null,
      isUp: result.isUp,
      classification: result.classification,
      errorMessage: result.errorMessage,
      checkedAt,
    });
    const logId = Number(logInsert.insertId);
    const decision = decideIncidentTransition({
      isUp: result.isUp,
      currentStatus: monitor.currentStatus,
      consecutiveFailures: monitor.consecutiveFailures,
      consecutiveSuccesses: monitor.consecutiveSuccesses,
      hasActiveIncident: Boolean(active),
    });

    let incidentAction: CheckEvent["incidentAction"] = "none";
    let incidentId: number | null = active?.id ?? null;
    let durationSeconds: number | null = null;
    if (decision.kind === "suspect_started") {
      const [inserted] = await tx.insert(incidents).values({
        monitorId: monitor.id,
        startedAt: checkedAt,
        status: "suspect",
        reason: result.errorMessage ?? result.classification,
        lastFailureLogId: logId,
      });
      incidentId = Number(inserted.insertId);
    } else if (decision.kind === "confirmed" && active) {
      await tx
        .update(incidents)
        .set({
          status: "confirmed",
          confirmedAt: checkedAt,
          reason: result.errorMessage ?? result.classification,
          lastFailureLogId: logId,
        })
        .where(eq(incidents.id, active.id));
      incidentAction = "failure";
    } else if (decision.kind === "suspect_resolved" && active) {
      durationSeconds = Math.max(
        0,
        Math.round((checkedAt.getTime() - active.startedAt.getTime()) / 1000)
      );
      await tx
        .update(incidents)
        .set({ status: "resolved", resolvedAt: checkedAt, durationSeconds })
        .where(eq(incidents.id, active.id));
    } else if (decision.kind === "resolved" && active) {
      durationSeconds = Math.max(
        0,
        Math.round((checkedAt.getTime() - active.startedAt.getTime()) / 1000)
      );
      await tx
        .update(incidents)
        .set({ status: "resolved", resolvedAt: checkedAt, durationSeconds })
        .where(eq(incidents.id, active.id));
      incidentAction = "recovery";
    }

    // Keep the last known certificate when the check never reached HTTP;
    // a plain-HTTP success clears it, an HTTPS success refreshes it.
    const sslPatch = result.certificate
      ? {
          sslIssuer: result.certificate.issuer,
          sslSubject: result.certificate.subject,
          sslValidTo: result.certificate.validTo
            ? new Date(result.certificate.validTo)
            : null,
        }
      : result.statusCode !== null
        ? { sslIssuer: null, sslSubject: null, sslValidTo: null }
        : {};

    await tx
      .update(monitors)
      .set({
        currentStatus: decision.nextStatus,
        consecutiveFailures: decision.failures,
        consecutiveSuccesses: decision.successes,
        lastCheckAt: checkedAt,
        nextCheckAt: new Date(
          checkedAt.getTime() + monitor.intervalSeconds * 1000
        ),
        ...sslPatch,
      })
      .where(eq(monitors.id, monitor.id));

    return {
      monitorId: monitor.id,
      userId: monitor.userId,
      monitorName: monitor.name,
      monitorUrl: monitor.url,
      statusCode: result.statusCode,
      responseTimeMs: result.responseTimeMs,
      phases: result.phases,
      classification: result.classification,
      isUp: result.isUp,
      incidentAction,
      incidentId,
      durationSeconds,
      detectedAt: checkedAt,
    };
  });

  return event;
}
