import { eq } from "drizzle-orm";
import type { Express, Request, Response } from "express";
import { statusPages } from "@shared/db/schema";
import { getDb } from "../db";
import { consumeRateLimit } from "../auth/rateLimit";
import { statusPageUpsertSchema } from "@shared/contracts";
import { asyncHandler, requireUser, sendError } from "../_core/http";
import { buildPublicStatusPayload } from "./analysis";

/** Matches statusPageSlugSchema in the shared contracts. */
const SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])$|^[a-z0-9]$/;

function serializePage(page: typeof statusPages.$inferSelect) {
  return {
    id: page.id,
    slug: page.slug,
    title: page.title,
    description: page.description,
    createdAt: page.createdAt,
  };
}

function limitStatusPageWrites(req: Request, res: Response): boolean {
  const rate = consumeRateLimit(
    `status-page-write:${req.ip ?? "unknown"}`,
    20,
    60_000
  );
  if (rate.allowed) return true;
  sendError(
    res,
    429,
    "RATE_LIMITED",
    "Trop de requêtes, réessayez dans un instant",
    rate.retryAfterSeconds
  );
  return false;
}

export function registerStatusPageRoutes(app: Express): void {
  app.get(
    "/api/status-page",
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
        .from(statusPages)
        .where(eq(statusPages.userId, user.id))
        .limit(1);
      res.setHeader("Cache-Control", "private, no-store");
      return res.json({
        statusPage: rows.length > 0 ? serializePage(rows[0]) : null,
      });
    })
  );

  app.put(
    "/api/status-page",
    asyncHandler(async (req, res) => {
      if (!limitStatusPageWrites(req, res)) return;
      const user = await requireUser(req, res);
      if (!user) return;
      const parsed = statusPageUpsertSchema.safeParse(req.body);
      if (!parsed.success)
        return sendError(
          res,
          400,
          "VALIDATION_ERROR",
          parsed.error.issues[0]?.message ?? "Requête invalide"
        );
      const db = await getDb();
      if (!db)
        return sendError(
          res,
          503,
          "DATABASE_UNAVAILABLE",
          "Service unavailable"
        );

      const values = {
        slug: parsed.data.slug,
        title: parsed.data.title,
        description: parsed.data.description,
      };
      const existing = await db
        .select()
        .from(statusPages)
        .where(eq(statusPages.userId, user.id))
        .limit(1);

      let row: typeof statusPages.$inferSelect;
      try {
        if (existing.length > 0) {
          await db
            .update(statusPages)
            .set(values)
            .where(eq(statusPages.id, existing[0].id));
          row = { ...existing[0], ...values };
        } else {
          await db.insert(statusPages).values({ ...values, userId: user.id });
          const created = await db
            .select()
            .from(statusPages)
            .where(eq(statusPages.userId, user.id))
            .limit(1);
          if (created.length === 0)
            return sendError(
              res,
              500,
              "INTERNAL_ERROR",
              "An unexpected error occurred"
            );
          row = created[0];
        }
      } catch (error) {
        const code = (error as { code?: string }).code;
        if (code === "ER_DUP_ENTRY")
          return sendError(
            res,
            409,
            "SLUG_TAKEN",
            "Ce slug est déjà utilisé, choisissez-en un autre"
          );
        throw error;
      }
      return res.json({ statusPage: serializePage(row) });
    })
  );

  app.delete(
    "/api/status-page",
    asyncHandler(async (req, res) => {
      if (!limitStatusPageWrites(req, res)) return;
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
      await db.delete(statusPages).where(eq(statusPages.userId, user.id));
      return res.status(204).send();
    })
  );

  app.get(
    "/api/public/status/:slug",
    asyncHandler(async (req, res) => {
      const rate = consumeRateLimit(
        `public-status:${req.ip ?? "unknown"}`,
        60,
        60_000
      );
      if (!rate.allowed)
        return sendError(
          res,
          429,
          "RATE_LIMITED",
          "Trop de requêtes, réessayez dans un instant",
          rate.retryAfterSeconds
        );
      const slug = req.params.slug;
      if (!SLUG_PATTERN.test(slug))
        return sendError(res, 404, "NOT_FOUND", "Page de statut introuvable");
      const db = await getDb();
      if (!db)
        return sendError(
          res,
          503,
          "DATABASE_UNAVAILABLE",
          "Service unavailable"
        );

      const pages = await db
        .select()
        .from(statusPages)
        .where(eq(statusPages.slug, slug))
        .limit(1);
      if (pages.length === 0)
        return sendError(res, 404, "NOT_FOUND", "Page de statut introuvable");
      const page = pages[0];
      const payload = await buildPublicStatusPayload(db, page, new Date());
      res.setHeader("Cache-Control", "public, max-age=30");
      return res.json(payload);
    })
  );
}
