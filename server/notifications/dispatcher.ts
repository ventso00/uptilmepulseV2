import { and, desc, eq, lt, or } from "drizzle-orm";
import {
  incidents,
  monitors,
  notificationChannels,
  notificationDeliveries,
  pingLogs,
} from "@shared/db/schema";
import { getDb } from "../db";
import { isDuplicateKeyError, safeErrorMessage } from "../_core/db-error";
import { decryptTelegramConfig } from "./crypto";
import { sendTelegramMessage } from "./telegram";

type Database = NonNullable<Awaited<ReturnType<typeof getDb>>>;

export type IncidentNotificationEvent = {
  userId: number;
  incidentId: number;
  type: "failure" | "recovery";
  monitorName: string;
  monitorUrl: string;
  statusCode: number | null;
  responseTimeMs: number | null;
  classification: string;
  detectedAt: Date;
  durationSeconds?: number | null;
};

function formatMessage(event: IncidentNotificationEvent): string {
  const title =
    event.type === "failure" ? "Incident confirmé" : "Service rétabli";
  const lines = [
    `UptimePulse — ${title}`,
    `Monitor : ${event.monitorName}`,
    `URL : ${event.monitorUrl}`,
    `Classification : ${event.classification}`,
    `Code HTTP : ${event.statusCode ?? "—"}`,
    `Temps de réponse : ${event.responseTimeMs === null ? "—" : `${event.responseTimeMs} ms`}`,
    `Détection : ${event.detectedAt.toISOString()}`,
  ];
  if (event.type === "recovery")
    lines.push(`Durée de l’incident : ${event.durationSeconds ?? 0} s`);
  return lines.join("\n");
}

async function deliverExisting(
  db: Database,
  channel: typeof notificationChannels.$inferSelect,
  deliveryId: number,
  event: IncidentNotificationEvent,
  previousAttempts = 0
): Promise<void> {
  let lastError = "Delivery failed";
  for (let offset = 1; offset <= 3; offset += 1) {
    const attempt = previousAttempts + offset;
    try {
      const config =
        channel.type === "telegram"
          ? decryptTelegramConfig(channel.configurationEncrypted)
          : null;
      if (!config) throw new Error("Unsupported notification channel");
      await sendTelegramMessage({ ...config, text: formatMessage(event) });
      await db
        .update(notificationDeliveries)
        .set({
          status: "sent",
          attempts: attempt,
          sentAt: new Date(),
          lastError: null,
        })
        .where(eq(notificationDeliveries.id, deliveryId));
      console.log(
        JSON.stringify({
          event: "notification_delivery",
          deliveryId,
          status: "sent",
          attempts: attempt,
        })
      );
      return;
    } catch (error) {
      lastError = safeErrorMessage(error, "Delivery failed")
        .replace(/[\r\n]+/g, " ")
        .slice(0, 500);
      await db
        .update(notificationDeliveries)
        .set({
          status: "failed",
          attempts: attempt,
          lastError,
        })
        .where(eq(notificationDeliveries.id, deliveryId));
    }
  }
  console.warn(
    JSON.stringify({
      event: "notification_delivery",
      deliveryId,
      status: "failed",
      attempts: previousAttempts + 3,
    })
  );
}

async function createDelivery(
  db: Database,
  event: IncidentNotificationEvent,
  channel: typeof notificationChannels.$inferSelect
): Promise<number | null> {
  try {
    const [delivery] = await db.insert(notificationDeliveries).values({
      incidentId: event.incidentId,
      channelId: channel.id,
      type: event.type,
      status: "pending",
      attempts: 0,
    });
    return Number(delivery.insertId);
  } catch (error) {
    // Only a unique-index conflict means "already queued". Swallowing every
    // error here reinterpreted a database outage as a successful dedupe, and
    // the alert was silently lost.
    if (!isDuplicateKeyError(error)) {
      console.error(
        JSON.stringify({
          event: "notification_delivery_insert_failed",
          incidentId: event.incidentId,
          channelId: channel.id,
          message: safeErrorMessage(error),
        })
      );
      throw error;
    }
    const existing = await db
      .select()
      .from(notificationDeliveries)
      .where(
        and(
          eq(notificationDeliveries.incidentId, event.incidentId),
          eq(notificationDeliveries.channelId, channel.id),
          eq(notificationDeliveries.type, event.type)
        )
      )
      .limit(1);
    if (!existing[0] || existing[0].status === "sent") return null;
    return existing[0].id;
  }
}

export async function dispatchIncidentNotification(
  event: IncidentNotificationEvent
): Promise<void> {
  const db = await getDb();
  if (!db) return;
  const channels = await db
    .select()
    .from(notificationChannels)
    .where(
      and(
        eq(notificationChannels.userId, event.userId),
        eq(notificationChannels.enabled, true)
      )
    );
  for (const channel of channels) {
    const deliveryId = await createDelivery(db, event, channel);
    if (deliveryId !== null)
      await deliverExisting(db, channel, deliveryId, event);
  }
}

export async function retryFailedNotificationDeliveries(
  limit = 20
): Promise<number> {
  const db = await getDb();
  if (!db) return 0;
  const retryBefore = new Date(Date.now() - 60_000);
  const rows = await db
    .select({
      delivery: notificationDeliveries,
      channel: notificationChannels,
      incident: incidents,
      monitor: monitors,
    })
    .from(notificationDeliveries)
    .innerJoin(
      notificationChannels,
      eq(notificationDeliveries.channelId, notificationChannels.id)
    )
    .innerJoin(incidents, eq(notificationDeliveries.incidentId, incidents.id))
    .innerJoin(monitors, eq(incidents.monitorId, monitors.id))
    .where(
      or(
        eq(notificationDeliveries.status, "failed"),
        and(
          eq(notificationDeliveries.status, "pending"),
          lt(notificationDeliveries.createdAt, retryBefore)
        )
      )
    )
    .limit(limit);

  let retried = 0;
  for (const row of rows) {
    if (row.delivery.type !== "failure" && row.delivery.type !== "recovery")
      continue;
    const [latest] = await db
      .select()
      .from(pingLogs)
      .where(eq(pingLogs.monitorId, row.monitor.id))
      .orderBy(desc(pingLogs.checkedAt))
      .limit(1);
    if (!latest) continue;
    await deliverExisting(
      db,
      row.channel,
      row.delivery.id,
      {
        userId: row.channel.userId,
        incidentId: row.incident.id,
        type: row.delivery.type,
        monitorName: row.monitor.name,
        monitorUrl: row.monitor.url,
        statusCode: latest.statusCode,
        responseTimeMs: latest.responseTimeMs,
        classification: latest.classification,
        detectedAt: row.incident.confirmedAt ?? row.incident.startedAt,
        durationSeconds: row.incident.durationSeconds,
      },
      row.delivery.attempts
    );
    retried += 1;
  }
  return retried;
}

export async function listNotificationDeliveries(incidentId: number) {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(notificationDeliveries)
    .where(eq(notificationDeliveries.incidentId, incidentId));
}
