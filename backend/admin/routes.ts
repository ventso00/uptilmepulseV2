import { and, count, desc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import type { Express, Request, Response } from "express";
import {
  incidents,
  monitors,
  notificationChannels,
  plans,
  users,
  type Plan,
} from "@shared/db/schema";
import {
  planUpsertSchema,
  userPlanAssignmentSchema,
  type PlanPublic,
} from "@shared/contracts";
import { getDb } from "../db";
import { consumeRateLimit } from "../auth/rateLimit";
import { resolvePlan } from "../plans/service";
import {
  asyncHandler,
  parseId,
  requireAdmin,
  requireUser,
  sendError,
} from "../_core/http";

/** Accounts with no explicit plan resolve to this slug, so the console reports
 * their usage against it instead of dropping it. */
const FALLBACK_SLUG = "free";
/** Also the cap the client paginates against; the console shows recent sign-ins. */
const MAX_OVERVIEW_USERS = 200;
const OPEN_INCIDENT_STATUSES = ["suspect", "confirmed"] as const;

function serializePlanAdmin(row: Plan) {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    maxMonitors: row.maxMonitors,
    minIntervalSeconds: row.minIntervalSeconds,
    maxTimeoutMs: row.maxTimeoutMs,
    maxChannels: row.maxChannels,
    allowKeyword: row.allowKeyword,
    priceCents: row.priceCents,
    trialDays: row.trialDays,
    isPublic: row.isPublic,
    sortOrder: row.sortOrder,
  };
}

function serializePlanPublic(row: Plan) {
  const {
    id: _id,
    isPublic: _isPublic,
    sortOrder: _sortOrder,
    ...publicFields
  } = serializePlanAdmin(row);
  return publicFields;
}

/**
 * Display order for every public tier list. `free` is pinned first regardless of
 * `sortOrder`: the console owns that column, and a mistuned value must never
 * make the seeded fallback look like the entry price.
 */
function pricingOrder(a: PlanPublic, b: PlanPublic): number {
  if (a.slug === FALLBACK_SLUG) return -1;
  if (b.slug === FALLBACK_SLUG) return 1;
  return a.priceCents - b.priceCents;
}

function unavailable(res: Response) {
  return sendError(res, 503, "DATABASE_UNAVAILABLE", "Service indisponible");
}

function limitAdminWrites(req: Request, res: Response): boolean {
  const rate = consumeRateLimit(
    `admin-write:${req.ip ?? "unknown"}`,
    60,
    60_000
  );
  if (rate.allowed) return true;
  sendError(
    res,
    429,
    "RATE_LIMITED",
    "Trop de requêtes d’administration, réessayez plus tard.",
    rate.retryAfterSeconds
  );
  return false;
}

function totalOf(rows: { total: number }[] | undefined): number {
  return Number(rows?.[0]?.total ?? 0);
}

export function registerPlanRoutes(app: Express): void {
  // Pricing strip: the console owns `sortOrder`, so the visible order is derived
  // from price with the `free` fallback pinned first.
  app.get(
    "/api/plans",
    asyncHandler(async (_req, res) => {
      const db = await getDb();
      if (!db) return unavailable(res);
      const rows = await db
        .select()
        .from(plans)
        .where(eq(plans.isPublic, true))
        .orderBy(plans.priceCents);
      res.setHeader("Cache-Control", "public, max-age=60");
      return res.json({
        plans: rows.map(serializePlanPublic).sort(pricingOrder),
      });
    })
  );

  // What this account is entitled to, and what it already consumed.
  app.get(
    "/api/plan",
    asyncHandler(async (req, res) => {
      const user = await requireUser(req, res);
      if (!user) return;
      const db = await getDb();
      if (!db) return unavailable(res);
      const [plan, monitorRows, channelRows] = await Promise.all([
        resolvePlan(db, user),
        db
          .select({ total: count() })
          .from(monitors)
          .where(eq(monitors.userId, user.id)),
        db
          .select({ total: count() })
          .from(notificationChannels)
          .where(eq(notificationChannels.userId, user.id)),
      ]);
      res.setHeader("Cache-Control", "private, no-store");
      return res.json({
        plan,
        usage: {
          monitors: totalOf(monitorRows),
          channels: totalOf(channelRows),
        },
        trialEndsAt: user.trialEndsAt,
      });
    })
  );
}

export function registerAdminRoutes(app: Express): void {
  app.get(
    "/api/admin/overview",
    asyncHandler(async (req, res) => {
      const admin = await requireAdmin(req, res);
      if (!admin) return;
      const db = await getDb();
      if (!db) return unavailable(res);

      const [
        planRows,
        userCount,
        adminCount,
        monitorCount,
        keywordCount,
        openIncidentCount,
        usersPerPlan,
        monitorsPerPlan,
        accountRows,
      ] = await Promise.all([
        db.select().from(plans).orderBy(plans.sortOrder, plans.priceCents),
        db.select({ total: count() }).from(users),
        db
          .select({ total: count() })
          .from(users)
          .where(eq(users.role, "admin")),
        db.select({ total: count() }).from(monitors),
        db
          .select({ total: count() })
          .from(monitors)
          .where(isNotNull(monitors.keyword)),
        db
          .select({ total: count() })
          .from(incidents)
          .where(inArray(incidents.status, [...OPEN_INCIDENT_STATUSES])),
        db
          .select({ planId: users.planId, total: count() })
          .from(users)
          .groupBy(users.planId),
        db
          .select({ planId: users.planId, total: count() })
          .from(monitors)
          .innerJoin(users, eq(monitors.userId, users.id))
          .groupBy(users.planId),
        db
          .select({
            id: users.id,
            email: users.email,
            name: users.name,
            role: users.role,
            planId: users.planId,
            trialEndsAt: users.trialEndsAt,
            lastSignedIn: users.lastSignedIn,
            monitorsUsed: sql<number>`COUNT(${monitors.id})`,
          })
          .from(users)
          .leftJoin(monitors, eq(monitors.userId, users.id))
          .groupBy(users.id)
          .orderBy(desc(users.lastSignedIn))
          .limit(MAX_OVERVIEW_USERS),
      ]);

      const fallback = planRows.find(row => row.slug === FALLBACK_SLUG);
      const planById = new Map(planRows.map(row => [row.id, row]));

      // `planId IS NULL` means the built-in free tier, so fold those counts into
      // the free row. Without a free row they would vanish from the console.
      const unmapped = { users: 0, monitors: 0 };
      const add = (
        planId: number | null,
        total: number,
        target: Map<number, number>,
        bucket: "users" | "monitors"
      ) => {
        if (planId !== null) {
          target.set(planId, (target.get(planId) ?? 0) + total);
          return;
        }
        if (!fallback) {
          unmapped[bucket] += total;
          return;
        }
        target.set(fallback.id, (target.get(fallback.id) ?? 0) + total);
      };
      const usersByPlan = new Map<number, number>();
      const monitorsByPlan = new Map<number, number>();
      for (const row of usersPerPlan)
        add(row.planId, totalOf([row]), usersByPlan, "users");
      for (const row of monitorsPerPlan)
        add(row.planId, totalOf([row]), monitorsByPlan, "monitors");

      const planSummaries = planRows.map(row => ({
        slug: row.slug,
        name: row.name,
        priceCents: row.priceCents,
        userCount: usersByPlan.get(row.id) ?? 0,
        monitorCount: monitorsByPlan.get(row.id) ?? 0,
      }));
      if (unmapped.users > 0 || unmapped.monitors > 0) {
        planSummaries.push({
          slug: FALLBACK_SLUG,
          name: "Free (plan absent)",
          priceCents: 0,
          userCount: unmapped.users,
          monitorCount: unmapped.monitors,
        });
      }

      res.setHeader("Cache-Control", "private, no-store");
      return res.json({
        totals: {
          users: totalOf(userCount),
          admins: totalOf(adminCount),
          monitors: totalOf(monitorCount),
          openIncidents: totalOf(openIncidentCount),
          keywordMonitors: totalOf(keywordCount),
        },
        plans: planSummaries,
        users: accountRows.map(row => {
          const plan =
            row.planId === null ? fallback : planById.get(row.planId);
          return {
            id: row.id,
            email: row.email,
            name: row.name,
            role: row.role,
            planSlug: plan?.slug ?? FALLBACK_SLUG,
            planName: plan?.name ?? "Free",
            monitorsUsed: Number(row.monitorsUsed),
            maxMonitors: plan?.maxMonitors ?? 3,
            trialEndsAt: row.trialEndsAt,
            lastSignedIn: row.lastSignedIn,
          };
        }),
      });
    })
  );

  app.get(
    "/api/admin/plans",
    asyncHandler(async (req, res) => {
      const admin = await requireAdmin(req, res);
      if (!admin) return;
      const db = await getDb();
      if (!db) return unavailable(res);
      const rows = await db
        .select()
        .from(plans)
        .orderBy(plans.sortOrder, plans.priceCents);
      res.setHeader("Cache-Control", "private, no-store");
      return res.json({ plans: rows.map(serializePlanAdmin) });
    })
  );

  app.post(
    "/api/admin/plans",
    asyncHandler(async (req, res) => {
      const admin = await requireAdmin(req, res);
      if (!admin) return;
      if (!limitAdminWrites(req, res)) return;
      const parsed = planUpsertSchema.safeParse(req.body);
      if (!parsed.success)
        return sendError(
          res,
          400,
          "VALIDATION_ERROR",
          "Les paramètres du plan sont invalides."
        );
      const db = await getDb();
      if (!db) return unavailable(res);
      const existing = await db
        .select({ id: plans.id })
        .from(plans)
        .where(eq(plans.slug, parsed.data.slug))
        .limit(1);
      if (existing.length > 0)
        return sendError(
          res,
          409,
          "CONFLICT",
          `Un plan porte déjà le slug « ${parsed.data.slug} ».`
        );
      const [result] = await db.insert(plans).values(parsed.data);
      const created = await db
        .select()
        .from(plans)
        .where(eq(plans.id, Number(result.insertId)))
        .limit(1);
      if (!created[0])
        return sendError(
          res,
          500,
          "INTERNAL_ERROR",
          "Enregistrement du plan perdu"
        );
      console.log(
        JSON.stringify({
          event: "admin_plan_created",
          actorId: admin.id,
          planId: result.insertId,
          slug: parsed.data.slug,
        })
      );
      return res.status(201).json({ plan: serializePlanAdmin(created[0]) });
    })
  );

  app.put(
    "/api/admin/plans/:id",
    asyncHandler(async (req, res) => {
      const admin = await requireAdmin(req, res);
      if (!admin) return;
      if (!limitAdminWrites(req, res)) return;
      const id = parseId(req.params.id);
      if (!id)
        return sendError(
          res,
          400,
          "VALIDATION_ERROR",
          "Identifiant de plan invalide."
        );
      const parsed = planUpsertSchema.safeParse(req.body);
      if (!parsed.success)
        return sendError(
          res,
          400,
          "VALIDATION_ERROR",
          "Les paramètres du plan sont invalides."
        );
      const db = await getDb();
      if (!db) return unavailable(res);
      const current = await db
        .select()
        .from(plans)
        .where(eq(plans.id, id))
        .limit(1);
      if (!current[0])
        return sendError(res, 404, "NOT_FOUND", "Plan introuvable");
      if (
        current[0].slug === FALLBACK_SLUG &&
        parsed.data.slug !== FALLBACK_SLUG
      )
        return sendError(
          res,
          409,
          "CONFLICT",
          "Le plan de secours « free » ne peut pas être renommé."
        );
      if (
        current[0].slug !== FALLBACK_SLUG &&
        parsed.data.slug === FALLBACK_SLUG
      )
        return sendError(
          res,
          409,
          "CONFLICT",
          "Le slug « free » est réservé au plan de secours."
        );
      const duplicate = await db
        .select({ id: plans.id })
        .from(plans)
        .where(and(eq(plans.slug, parsed.data.slug), sql`${plans.id} <> ${id}`))
        .limit(1);
      if (duplicate.length > 0)
        return sendError(
          res,
          409,
          "CONFLICT",
          `Un plan porte déjà le slug « ${parsed.data.slug} ».`
        );

      await db.update(plans).set(parsed.data).where(eq(plans.id, id));
      const updated = await db
        .select()
        .from(plans)
        .where(eq(plans.id, id))
        .limit(1);
      if (!updated[0])
        return sendError(
          res,
          500,
          "INTERNAL_ERROR",
          "Mise à jour du plan non relue"
        );
      // Monitors above a lowered limit are kept: the console narrows what a plan
      // allows from now on, it does not destroy customer data.
      console.log(
        JSON.stringify({
          event: "admin_plan_updated",
          actorId: admin.id,
          planId: id,
          slug: parsed.data.slug,
        })
      );
      return res.json({ plan: serializePlanAdmin(updated[0]) });
    })
  );

  app.put(
    "/api/admin/users/:id/plan",
    asyncHandler(async (req, res) => {
      const admin = await requireAdmin(req, res);
      if (!admin) return;
      if (!limitAdminWrites(req, res)) return;
      const id = parseId(req.params.id);
      if (!id)
        return sendError(
          res,
          400,
          "VALIDATION_ERROR",
          "Identifiant de compte invalide."
        );
      const parsed = userPlanAssignmentSchema.safeParse(req.body);
      if (!parsed.success)
        return sendError(
          res,
          400,
          "VALIDATION_ERROR",
          "L’affectation de plan est invalide."
        );
      const db = await getDb();
      if (!db) return unavailable(res);
      const account = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.id, id))
        .limit(1);
      if (!account[0])
        return sendError(res, 404, "NOT_FOUND", "Compte introuvable");
      const plan = await db
        .select()
        .from(plans)
        .where(eq(plans.slug, parsed.data.planSlug))
        .limit(1);
      if (!plan[0])
        return sendError(
          res,
          404,
          "NOT_FOUND",
          `Aucun plan avec le slug « ${parsed.data.planSlug} ».`
        );
      // The free tier carries no trial; clearing trialEndsAt keeps the two
      // facts consistent instead of leaving an expired date behind.
      const trialEndsAt =
        parsed.data.trialDays > 0
          ? new Date(Date.now() + parsed.data.trialDays * 86_400_000)
          : null;
      await db
        .update(users)
        .set({
          planId: plan[0].slug === FALLBACK_SLUG ? null : plan[0].id,
          trialEndsAt,
        })
        .where(eq(users.id, id));
      console.log(
        JSON.stringify({
          event: "admin_plan_assigned",
          actorId: admin.id,
          targetUserId: id,
          planSlug: plan[0].slug,
          trialDays: parsed.data.trialDays,
        })
      );
      return res.json({ ok: true });
    })
  );
}
