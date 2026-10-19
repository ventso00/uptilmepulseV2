import { and, eq } from "drizzle-orm";
import type { z } from "zod";
import type { Express, Request, Response } from "express";
import {
  qaTickets,
  statusPages,
  type QaTicket as QaTicketRow,
} from "@shared/db/schema";
import { getDb, type Database } from "../db";
import { consumeRateLimit } from "../auth/rateLimit";
import { asyncHandler, parseId, requireUser, sendError } from "../_core/http";
import {
  qaReference,
  qaTicketCreateSchema,
  qaTicketEventCreateSchema,
  qaTicketReplyRequestSchema,
  qaTicketUpdateSchema,
  type QaTicketStatus,
} from "@shared/contracts";
import { buildClientReply, buildInternalReport } from "./report";
import { buildDailyDigest, lastDailyDigest } from "./digest";
import { lastSelfTestRun, qaOwnerUserId, runSelfTest } from "./selfTest";
import {
  addTicketEvent,
  assertTransition,
  computeTotals,
  createTicket,
  listTickets,
  monitorNameByIds,
  serializePublicTicket,
  serializeTicket,
  ticketEvents,
  transitionTicket,
} from "./tickets";

/** 16 random bytes as hex, the shape `newReporterToken()` produces. */
const REPORTER_TOKEN_PATTERN = /^[0-9a-f]{32}$/;
/**
 * Guards the link embedded in generated documents against header injection:
 * a host carrying whitespace or control characters could smuggle text into the
 * Markdown report or the client reply.
 */
const HOST_PATTERN = /^[A-Za-z0-9.\-:[\]]{1,253}$/;

/**
 * Follow-up links must be absolute, so the origin is needed. `APP_BASE_URL` is
 * the authoritative value; the request headers are only a development fallback,
 * and a `Host` header can be forged, hence the shape check above.
 */
export function requestOrigin(req: Request): string {
  const configured = process.env.APP_BASE_URL;
  if (configured) return configured.replace(/\/+$/, "");
  const forwardedHost = req.headers["x-forwarded-host"];
  const host = (
    typeof forwardedHost === "string" && forwardedHost.length > 0
      ? forwardedHost
      : (req.headers.host ?? "")
  ).split(",")[0];
  if (!HOST_PATTERN.test(host)) return "";
  const proto = String(req.headers["x-forwarded-proto"] ?? "http").split(
    ","
  )[0];
  return `${proto === "https" ? "https" : "http"}://${host}`;
}

/**
 * Field-level validation messages. A public form has to say *which* field was
 * refused, otherwise the reporter cannot correct the submission — a bare zod
 * message like "expected null, received undefined" is unactionable.
 */
function validationMessage(error: z.ZodError): string {
  const issue = error.issues[0];
  if (!issue) return "Requête invalide";
  const path = issue.path.join(".");
  return path
    ? `Champ « ${path} » : ${issue.message}`
    : (issue.message ?? "Requête invalide");
}

function limited(
  req: Request,
  res: Response,
  key: string,
  limit: number,
  windowMs: number
): boolean {
  const rate = consumeRateLimit(
    `${key}:${req.ip ?? "unknown"}`,
    limit,
    windowMs
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

async function ticketForUser(
  db: Database,
  userId: number,
  ticketId: number
): Promise<QaTicketRow | null> {
  const rows = await db
    .select()
    .from(qaTickets)
    .where(and(eq(qaTickets.id, ticketId), eq(qaTickets.userId, userId)))
    .limit(1);
  return rows[0] ?? null;
}

async function nameFor(
  db: Database,
  monitorId: number | null
): Promise<string | null> {
  if (monitorId === null) return null;
  const names = await monitorNameByIds(db, [monitorId]);
  return names.get(monitorId) ?? null;
}

/**
 * Everything the operator screen shows for one ticket. GET and the note POST
 * answer with the same body so posting a note refreshes the report in one round
 * trip instead of leaving a stale Markdown document on screen.
 */
async function detailPayload(
  db: Database,
  req: Request,
  row: QaTicketRow
): Promise<{
  ticket: ReturnType<typeof serializeTicket>;
  events: Awaited<ReturnType<typeof ticketEvents>>;
  reporterToken: string | null;
  internalReport: string;
}> {
  const ticket = serializeTicket(row, {
    monitorName: await nameFor(db, row.monitorId),
    now: new Date(),
  });
  const events = await ticketEvents(db, row.id, { publicOnly: false });
  return {
    ticket,
    events,
    reporterToken: row.reporterToken,
    internalReport: buildInternalReport(ticket, events, {
      reporterToken: row.reporterToken,
      origin: requestOrigin(req),
    }),
  };
}

export function registerQaRoutes(app: Express): void {
  /* ------------------------------------------------------------------ *
   * Public intake — no authentication, so every entry point is rate
   * limited and every field length is capped by the shared contract.
   * ------------------------------------------------------------------ */

  app.post(
    "/api/public/qa/tickets",
    asyncHandler(async (req, res) => {
      if (!limited(req, res, "qa-intake", 10, 15 * 60_000)) return;
      const parsed = qaTicketCreateSchema.safeParse(req.body);
      if (!parsed.success)
        return sendError(
          res,
          400,
          "VALIDATION_ERROR",
          validationMessage(parsed.error)
        );

      // A filled honeypot is a bot. Answer with a well-formed but unusable
      // token instead of signalling that the field is a trap.
      if (parsed.data.website.trim().length > 0) {
        return res.status(201).json({
          id: 0,
          reference: qaReference(0),
          reporterToken: "0".repeat(32),
        });
      }

      const db = await getDb();
      if (!db)
        return sendError(
          res,
          503,
          "DATABASE_UNAVAILABLE",
          "Service unavailable"
        );

      // The report is filed against the account that owns the public page when
      // a slug is given; otherwise it belongs to the QA owner. The client can
      // never choose an account id, so this is not an IDOR vector.
      let userId: number | null = null;
      if (parsed.data.statusSlug) {
        const pages = await db
          .select({ userId: statusPages.userId })
          .from(statusPages)
          .where(eq(statusPages.slug, parsed.data.statusSlug))
          .limit(1);
        if (pages.length === 0)
          return sendError(res, 404, "NOT_FOUND", "Page de statut introuvable");
        userId = pages[0].userId;
      } else {
        userId = await qaOwnerUserId(db);
      }
      if (userId === null)
        return sendError(
          res,
          503,
          "DATABASE_UNAVAILABLE",
          "Service unavailable"
        );

      const { row, reporterToken } = await createTicket(db, {
        userId,
        source: "client",
        kind: parsed.data.kind,
        title: parsed.data.title,
        clientMessage: parsed.data.clientMessage,
        steps: parsed.data.steps,
        expected: parsed.data.expected,
        actual: parsed.data.actual,
        reporterName: parsed.data.reporterName,
        reporterEmail: parsed.data.reporterEmail,
        pageUrl: parsed.data.pageUrl,
        evidence: parsed.data.evidence,
        withReporterToken: true,
      });

      res.setHeader("Cache-Control", "private, no-store");
      return res.status(201).json({
        id: row.id,
        reference: qaReference(row.id),
        reporterToken: reporterToken ?? "",
      });
    })
  );

  app.get(
    "/api/public/qa/tickets/:token",
    asyncHandler(async (req, res) => {
      if (!limited(req, res, "qa-followup-read", 60, 60_000)) return;
      const token = req.params.token;
      if (!REPORTER_TOKEN_PATTERN.test(token))
        return sendError(res, 404, "NOT_FOUND", "Signalement introuvable");
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
        .from(qaTickets)
        .where(eq(qaTickets.reporterToken, token))
        .limit(1);
      if (rows.length === 0)
        return sendError(res, 404, "NOT_FOUND", "Signalement introuvable");
      const row = rows[0];
      res.setHeader("Cache-Control", "private, no-store");
      return res.json({
        ticket: serializePublicTicket(row, await nameFor(db, row.monitorId)),
        // Public visibility only: an internal note must never reach the link.
        events: await ticketEvents(db, row.id, { publicOnly: true }),
      });
    })
  );

  app.post(
    "/api/public/qa/tickets/:token/messages",
    asyncHandler(async (req, res) => {
      if (!limited(req, res, "qa-followup-write", 20, 60 * 60_000)) return;
      const token = req.params.token;
      if (!REPORTER_TOKEN_PATTERN.test(token))
        return sendError(res, 404, "NOT_FOUND", "Signalement introuvable");
      const parsed = qaTicketEventCreateSchema.safeParse(req.body);
      if (!parsed.success)
        return sendError(
          res,
          400,
          "VALIDATION_ERROR",
          validationMessage(parsed.error)
        );
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
        .from(qaTickets)
        .where(eq(qaTickets.reporterToken, token))
        .limit(1);
      if (rows.length === 0)
        return sendError(res, 404, "NOT_FOUND", "Signalement introuvable");
      const row = rows[0];

      await addTicketEvent(db, {
        ticketId: row.id,
        author: "client",
        // The reporter's words are always public: they own the ticket.
        visibility: "public",
        body: parsed.data.body,
      });

      // A client answer is activity: a ticket parked waiting for them goes back
      // to the team without anyone moving it by hand.
      let current = row;
      if (row.status === "waiting_client") {
        current = await transitionTicket(
          db,
          row,
          "in_progress",
          [
            "Précisions reçues du client, l'analyse reprend.",
            `Réponse : ${parsed.data.body.slice(0, 500)}`,
          ].join(" ")
        );
      }

      res.setHeader("Cache-Control", "private, no-store");
      return res.json({
        ticket: serializePublicTicket(
          current,
          await nameFor(db, current.monitorId)
        ),
        events: await ticketEvents(db, row.id, { publicOnly: true }),
      });
    })
  );

  /* ------------------------------------------------------------------ *
   * Operator queue — authenticated and scoped to the caller's account.
   * ------------------------------------------------------------------ */

  app.get(
    "/api/qa/overview",
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
      const now = new Date();
      const [tickets, totals, lastRun, digest] = await Promise.all([
        listTickets(db, user.id, {}, now),
        computeTotals(db, user.id, now),
        lastSelfTestRun(db),
        lastDailyDigest(db),
      ]);
      res.setHeader("Cache-Control", "private, no-store");
      return res.json({
        totals,
        tickets,
        lastSelfTest: lastRun,
        digest,
        generatedAt: now,
      });
    })
  );

  app.get(
    "/api/qa/tickets",
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
      const status = req.query.status;
      const source = req.query.source;
      const tickets = await listTickets(db, user.id, {
        status:
          typeof status === "string" ? (status as QaTicketStatus) : undefined,
        source:
          typeof source === "string"
            ? (source as "client" | "auto" | "internal")
            : undefined,
      });
      return res.json({
        tickets,
        totals: await computeTotals(db, user.id),
      });
    })
  );

  app.get(
    "/api/qa/tickets/:id",
    asyncHandler(async (req, res) => {
      const user = await requireUser(req, res);
      if (!user) return;
      const id = parseId(req.params.id);
      if (id === null)
        return sendError(res, 400, "INVALID_ID", "Identifiant invalide");
      const db = await getDb();
      if (!db)
        return sendError(
          res,
          503,
          "DATABASE_UNAVAILABLE",
          "Service unavailable"
        );
      const row = await ticketForUser(db, user.id, id);
      if (!row) return sendError(res, 404, "NOT_FOUND", "Ticket introuvable");
      res.setHeader("Cache-Control", "private, no-store");
      return res.json(await detailPayload(db, req, row));
    })
  );

  app.patch(
    "/api/qa/tickets/:id",
    asyncHandler(async (req, res) => {
      if (!limited(req, res, "qa-operator-write", 60, 60_000)) return;
      const user = await requireUser(req, res);
      if (!user) return;
      const id = parseId(req.params.id);
      if (id === null)
        return sendError(res, 400, "INVALID_ID", "Identifiant invalide");
      const parsed = qaTicketUpdateSchema.safeParse(req.body);
      if (!parsed.success)
        return sendError(
          res,
          400,
          "VALIDATION_ERROR",
          validationMessage(parsed.error)
        );
      const db = await getDb();
      if (!db)
        return sendError(
          res,
          503,
          "DATABASE_UNAVAILABLE",
          "Service unavailable"
        );
      const row = await ticketForUser(db, user.id, id);
      if (!row) return sendError(res, 404, "NOT_FOUND", "Ticket introuvable");

      let current = row;
      const changes = {
        ...(parsed.data.severity ? { severity: parsed.data.severity } : {}),
        ...(parsed.data.kind ? { kind: parsed.data.kind } : {}),
        ...(parsed.data.title ? { title: parsed.data.title } : {}),
      };
      if (Object.keys(changes).length > 0) {
        await db.update(qaTickets).set(changes).where(eq(qaTickets.id, row.id));
        // A requalification is activity, so it resets the follow-up clock too.
        await addTicketEvent(db, {
          ticketId: row.id,
          author: "support",
          visibility: "internal",
          body: `Fiche mise à jour : ${Object.keys(changes).join(", ")}.`,
        });
        const rows = await db
          .select()
          .from(qaTickets)
          .where(eq(qaTickets.id, row.id))
          .limit(1);
        current = rows[0];
      }

      // Requalification and triage may arrive in one request, so the status
      // move happens after the field updates and always validates against the
      // row that is actually stored.
      if (parsed.data.status && parsed.data.status !== current.status) {
        const check = assertTransition(current.status, parsed.data.status);
        if (!check.allowed)
          return sendError(res, 409, "INVALID_TRANSITION", check.reason);
        current = await transitionTicket(db, current, parsed.data.status, null);
      }

      if (
        Object.keys(changes).length === 0 &&
        (!parsed.data.status || parsed.data.status === row.status)
      )
        return sendError(
          res,
          400,
          "VALIDATION_ERROR",
          "Aucune modification fournie"
        );

      return res.json({
        ticket: serializeTicket(current, {
          monitorName: await nameFor(db, current.monitorId),
          now: new Date(),
        }),
      });
    })
  );

  app.post(
    "/api/qa/tickets/:id/events",
    asyncHandler(async (req, res) => {
      if (!limited(req, res, "qa-operator-write", 60, 60_000)) return;
      const user = await requireUser(req, res);
      if (!user) return;
      const id = parseId(req.params.id);
      if (id === null)
        return sendError(res, 400, "INVALID_ID", "Identifiant invalide");
      const parsed = qaTicketEventCreateSchema.safeParse(req.body);
      if (!parsed.success)
        return sendError(
          res,
          400,
          "VALIDATION_ERROR",
          validationMessage(parsed.error)
        );
      const db = await getDb();
      if (!db)
        return sendError(
          res,
          503,
          "DATABASE_UNAVAILABLE",
          "Service unavailable"
        );
      const row = await ticketForUser(db, user.id, id);
      if (!row) return sendError(res, 404, "NOT_FOUND", "Ticket introuvable");

      await addTicketEvent(db, {
        ticketId: row.id,
        author: "support",
        visibility: parsed.data.visibility,
        body: parsed.data.body,
      });
      // Re-read: the event bumped `updatedAt`, so the idle counter shown after
      // posting a note must reflect that activity, not the pre-note value.
      const rows = await db
        .select()
        .from(qaTickets)
        .where(eq(qaTickets.id, row.id))
        .limit(1);
      return res.json(await detailPayload(db, req, rows[0]));
    })
  );

  /**
   * Drafts a French reply for the reporter. It writes nothing: there is no
   * outbound e-mail transport in this product, so the operator copies the text
   * and posts it as a public note, which is what makes it visible on the
   * reporter's follow-up link.
   */
  app.post(
    "/api/qa/tickets/:id/reply",
    asyncHandler(async (req, res) => {
      const user = await requireUser(req, res);
      if (!user) return;
      const id = parseId(req.params.id);
      if (id === null)
        return sendError(res, 400, "INVALID_ID", "Identifiant invalide");
      const parsed = qaTicketReplyRequestSchema.safeParse(req.body);
      if (!parsed.success)
        return sendError(
          res,
          400,
          "VALIDATION_ERROR",
          validationMessage(parsed.error)
        );
      const db = await getDb();
      if (!db)
        return sendError(
          res,
          503,
          "DATABASE_UNAVAILABLE",
          "Service unavailable"
        );
      const row = await ticketForUser(db, user.id, id);
      if (!row) return sendError(res, 404, "NOT_FOUND", "Ticket introuvable");
      const ticket = serializeTicket(row, {
        monitorName: await nameFor(db, row.monitorId),
        now: new Date(),
      });
      return res.json({
        template: {
          kind: parsed.data.kind,
          body: buildClientReply(ticket, parsed.data.kind, {
            reporterToken: row.reporterToken,
            origin: requestOrigin(req),
          }),
        },
      });
    })
  );

  app.get(
    "/api/qa/digest",
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
      const digest = await lastDailyDigest(db);
      if (!digest)
        return sendError(
          res,
          404,
          "NOT_FOUND",
          "Aucun point quotidien enregistré"
        );
      res.setHeader("Cache-Control", "private, no-store");
      return res.json(digest);
    })
  );

  app.post(
    "/api/qa/digest/run",
    asyncHandler(async (req, res) => {
      if (!limited(req, res, "qa-force-run", 6, 60_000)) return;
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
      const digest = await buildDailyDigest(db, { force: true });
      if (!digest)
        return sendError(
          res,
          409,
          "RUN_IN_PROGRESS",
          "Un point est déjà en cours pour cette période"
        );
      return res.json(digest);
    })
  );

  app.post(
    "/api/qa/self-tests/run",
    asyncHandler(async (req, res) => {
      if (!limited(req, res, "qa-force-run", 6, 60_000)) return;
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
      const run = await runSelfTest(db, { force: true });
      if (!run)
        return sendError(
          res,
          409,
          "RUN_IN_PROGRESS",
          "Une passe est déjà en cours pour cette période"
        );
      return res.json({ run });
    })
  );
}
