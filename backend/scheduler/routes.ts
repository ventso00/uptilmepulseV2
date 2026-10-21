import type { Express, Request, Response } from "express";
import { getDb } from "../db";
import { sendError, asyncHandler } from "../_core/http";
import { runSchedulerTick } from "./tick";
import { verifyHeartbeatRequest } from "./heartbeatAuth";
import { BATCH_SIZE } from "./limits";

export { BATCH_SIZE };

export function registerSchedulerRoutes(app: Express): void {
  app.post(
    "/api/scheduled/checks",
    asyncHandler(async (req: Request, res: Response) => {
      if (!(await verifyHeartbeatRequest(req)))
        return sendError(
          res,
          401,
          "UNAUTHORIZED",
          "Scheduled callback authentication failed"
        );
      const db = await getDb();
      if (!db)
        return sendError(
          res,
          503,
          "DATABASE_UNAVAILABLE",
          "Service unavailable"
        );

      const tick = await runSchedulerTick();
      return res.status(200).json({
        accepted: true,
        processed: tick.processed,
        retriedNotifications: tick.retriedNotifications,
        batchSize: BATCH_SIZE,
      });
    })
  );
}
