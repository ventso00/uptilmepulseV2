import { createHeartbeatJob, listHeartbeatJobs } from "../_core/heartbeat";
import { ENV } from "../_core/env";

const JOB_NAME = "uptimepulse-checks";

export async function ensureHeartbeatJob(): Promise<void> {
  if (!ENV.forgeApiUrl || !ENV.forgeApiKey) return;
  try {
    const existing = await listHeartbeatJobs("");
    if (existing.jobs.some(job => job.name === JOB_NAME && job.isEnable))
      return;
    await createHeartbeatJob(
      {
        name: JOB_NAME,
        cron: "0 * * * * *",
        path: "/api/scheduled/checks",
        method: "POST",
        description: "UptimePulse checks due monitors every minute",
      },
      ""
    );
    console.log(
      JSON.stringify({ event: "heartbeat_registered", job: JOB_NAME })
    );
  } catch {
    console.warn(
      JSON.stringify({ event: "heartbeat_registration_failed", job: JOB_NAME })
    );
  }
}
