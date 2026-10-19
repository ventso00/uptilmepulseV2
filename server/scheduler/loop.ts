import { runSchedulerTick } from "./tick";
import { safeErrorMessage } from "../_core/db-error";

let timer: ReturnType<typeof setInterval> | null = null;
let running = false;

/**
 * Self-sustaining scheduler. The platform heartbeat is an external trigger
 * only: nothing guarantees it fires (it is absent in local dev, and silently
 * lost if the platform service hiccups). Without a tick, monitors never move
 * past UNKNOWN and the product does not work. This loop runs the exact same
 * pass on a fixed interval; concurrent ticks from other instances or from the
 * heartbeat stay safe because each check is claimed atomically.
 *
 * Opt out with SCHEDULER_INTERNAL=0 (e.g. a future multi-node deployment that
 * standardises on an external cron).
 */
export function startInternalScheduler(
  intervalMs = 30_000
): (() => void) | null {
  if (timer || process.env.SCHEDULER_INTERNAL === "0") return null;
  const pump = () => {
    if (running) return;
    running = true;
    runSchedulerTick()
      .catch(error => {
        console.error(
          JSON.stringify({
            event: "scheduler_loop_error",
            message: safeErrorMessage(error, "scheduler tick failed"),
          })
        );
      })
      .finally(() => {
        running = false;
      });
  };
  timer = setInterval(pump, intervalMs);
  // First pass shortly after boot: a restarted server must not leave due
  // monitors waiting for another full interval.
  const kickoff = setTimeout(pump, 2_000);
  kickoff.unref();
  return () => {
    if (timer) clearInterval(timer);
    timer = null;
  };
}
