import { and, asc, eq, lte } from "drizzle-orm";
import { monitors } from "@shared/db/schema";
import { getDb } from "../db";
import { runMonitorCheck } from "../checks/engine";
import { retryFailedNotificationDeliveries } from "../notifications/dispatcher";
import { maybeRunDailyDigest } from "../qa/digest";
import { maybeRunSelfTest } from "../qa/selfTest";
import { mapWithConcurrency } from "./pool";
import { runRetentionSweep, type RetentionCounts } from "./retention";
import { BATCH_SIZE } from "./limits";
/**
 * Each check can block for up to the monitor timeout (30s). A serial loop over
 * 50 monitors therefore overruns the 60s cron, so ticks overlap and monitors
 * are silently skipped. Ten in-flight checks keep the worst case near 150s
 * while staying far below the pool and socket limits.
 */
const CHECK_CONCURRENCY = 10;

export type SchedulerTickResult = {
  due: number;
  processed: number;
  failed: number;
  retriedNotifications: number;
  retention: RetentionCounts | null;
};

/**
 * One full pass: notification retries, due monitors, retention sweep. Shared
 * by the authenticated heartbeat callback and the in-process scheduler so the
 * app can never depend solely on an external cron to make checks happen.
 */
export async function runSchedulerTick(): Promise<SchedulerTickResult> {
  const db = await getDb();
  if (!db) throw new Error("Database is not available");

  let retriedNotifications = 0;
  try {
    retriedNotifications = await retryFailedNotificationDeliveries();
  } catch (error) {
    console.warn(
      JSON.stringify({
        event: "notification_retry_error",
        message: error instanceof Error ? error.message : "retry failed",
      })
    );
  }
  const due = await db
    .select({ id: monitors.id })
    .from(monitors)
    .where(
      and(eq(monitors.enabled, true), lte(monitors.nextCheckAt, new Date()))
    )
    .orderBy(asc(monitors.nextCheckAt))
    .limit(BATCH_SIZE);

  // A single failing monitor must not abort the whole batch.
  const outcomes = await mapWithConcurrency(
    due,
    CHECK_CONCURRENCY,
    async monitor => {
      try {
        return (await runMonitorCheck(monitor.id)) !== null;
      } catch (error) {
        console.error(
          JSON.stringify({
            event: "monitor_check_failed",
            monitorId: monitor.id,
            message: error instanceof Error ? error.message : "unknown error",
          })
        );
        return false;
      }
    }
  );
  const processed = outcomes.filter(Boolean).length;
  let retention: RetentionCounts | null = null;
  try {
    retention = await runRetentionSweep(db);
  } catch (error) {
    console.warn(
      JSON.stringify({
        event: "retention_sweep_error",
        message: error instanceof Error ? error.message : "retention failed",
      })
    );
  }
  // Quality passes ride the same tick. Each one claims a UTC period in
  // `qa_runs`, so calling them every 30 seconds costs a duplicate-key skip and
  // neither can duplicate work across instances or with an external cron.
  // Both swallow their own failures: a broken self-test must not stop checks.
  await maybeRunSelfTest(new Date());
  await maybeRunDailyDigest(new Date());

  const result = {
    due: due.length,
    processed,
    failed: due.length - processed,
    retriedNotifications,
    retention,
  };
  console.log(
    JSON.stringify({
      event: "scheduler_tick",
      ...result,
      batchSize: BATCH_SIZE,
      concurrency: CHECK_CONCURRENCY,
    })
  );
  return result;
}
