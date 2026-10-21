import { and, count, eq } from "drizzle-orm";
import { z } from "zod";
import type { Express, Request, Response } from "express";
import { notificationChannels } from "@shared/db/schema";
import { getDb } from "../db";
import { consumeRateLimit } from "../auth/rateLimit";
import { assertChannelQuota, resolvePlan } from "../plans/service";
import { respondPlanError } from "../plans/respond";
import { encryptTelegramConfig, decryptTelegramConfig } from "./crypto";
import { sendTelegramMessage } from "./telegram";
import { asyncHandler, parseId, requireUser, sendError } from "../_core/http";

/** Validated with zod rather than hand-rolled typeof checks, and trimmed so a
 * trailing space in a pasted token cannot fail at decrypt time. */
const telegramChannelSchema = z.object({
  type: z.literal("telegram"),
  botToken: z.string().trim().min(10).max(512),
  chatId: z.string().trim().min(1).max(128),
});

function rejectWhenLimited(
  res: Response,
  key: string,
  limit: number,
  windowMs: number
): boolean {
  const rate = consumeRateLimit(key, limit, windowMs);
  if (rate.allowed) return false;
  sendError(
    res,
    429,
    "RATE_LIMITED",
    "Too many attempts",
    rate.retryAfterSeconds
  );
  return true;
}

export function registerNotificationRoutes(app: Express): void {
  app.get(
    "/api/notification-channels",
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
      const channels = await db
        .select({
          id: notificationChannels.id,
          type: notificationChannels.type,
          enabled: notificationChannels.enabled,
          createdAt: notificationChannels.createdAt,
          updatedAt: notificationChannels.updatedAt,
        })
        .from(notificationChannels)
        .where(eq(notificationChannels.userId, user.id));
      res.setHeader("Cache-Control", "private, no-store");
      return res.json({ channels });
    })
  );

  app.post(
    "/api/notification-channels",
    asyncHandler(async (req, res) => {
      const user = await requireUser(req, res);
      if (!user) return;
      if (rejectWhenLimited(res, `channel:${user.id}`, 5, 15 * 60_000)) return;

      const parsed = telegramChannelSchema.safeParse(req.body);
      if (!parsed.success)
        return sendError(
          res,
          400,
          "VALIDATION_ERROR",
          "Telegram configuration is invalid"
        );
      const db = await getDb();
      if (!db)
        return sendError(
          res,
          503,
          "DATABASE_UNAVAILABLE",
          "Service unavailable"
        );
      const encrypted = encryptTelegramConfig({
        botToken: parsed.data.botToken,
        chatId: parsed.data.chatId,
      });
      const plan = await resolvePlan(db, user);
      // Count and insert in one transaction, so two parallel requests cannot
      // both read the same free slot.
      const inserted = await db
        .transaction(async tx => {
          const [{ total }] = await tx
            .select({ total: count() })
            .from(notificationChannels)
            .where(eq(notificationChannels.userId, user.id));
          assertChannelQuota(plan, Number(total));
          const [result] = await tx.insert(notificationChannels).values({
            userId: user.id,
            type: "telegram",
            configurationEncrypted: encrypted,
            enabled: true,
          });
          return Number(result.insertId);
        })
        .catch(error => {
          if (respondPlanError(res, error)) return null;
          throw error;
        });
      if (inserted === null) return;
      return res.status(201).json({
        channel: {
          id: inserted,
          type: "telegram",
          enabled: true,
        },
      });
    })
  );

  app.delete(
    "/api/notification-channels/:id",
    asyncHandler(async (req, res) => {
      const user = await requireUser(req, res);
      if (!user) return;
      const id = parseId(req.params.id);
      if (!id)
        return sendError(res, 400, "VALIDATION_ERROR", "Channel id is invalid");
      const db = await getDb();
      if (!db)
        return sendError(
          res,
          503,
          "DATABASE_UNAVAILABLE",
          "Service unavailable"
        );
      const deleted = await db
        .delete(notificationChannels)
        .where(
          and(
            eq(notificationChannels.id, id),
            eq(notificationChannels.userId, user.id)
          )
        );
      if (Number(deleted[0].affectedRows) === 0)
        return sendError(res, 404, "NOT_FOUND", "Channel not found");
      return res.status(204).send();
    })
  );

  app.post(
    "/api/notification-channels/:id/test",
    asyncHandler(async (req, res) => {
      const user = await requireUser(req, res);
      if (!user) return;
      if (rejectWhenLimited(res, `channel-test:${user.id}`, 3, 15 * 60_000))
        return;
      const id = parseId(req.params.id);
      if (!id)
        return sendError(res, 400, "VALIDATION_ERROR", "Channel id is invalid");
      const db = await getDb();
      if (!db)
        return sendError(
          res,
          503,
          "DATABASE_UNAVAILABLE",
          "Service unavailable"
        );
      const channel = await db
        .select()
        .from(notificationChannels)
        .where(
          and(
            eq(notificationChannels.id, id),
            eq(notificationChannels.userId, user.id),
            eq(notificationChannels.enabled, true)
          )
        )
        .limit(1);
      if (!channel[0])
        return sendError(res, 404, "NOT_FOUND", "Channel not found");
      try {
        const config = decryptTelegramConfig(channel[0].configurationEncrypted);
        await sendTelegramMessage({
          ...config,
          text: "UptimePulse — notification de test réussie.",
        });
        return res.json({ success: true });
      } catch {
        return sendError(
          res,
          502,
          "DELIVERY_FAILED",
          "Notification delivery failed"
        );
      }
    })
  );
}
