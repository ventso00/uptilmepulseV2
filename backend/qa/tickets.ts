import { randomBytes } from "node:crypto";
import { and, desc, eq, inArray, lt } from "drizzle-orm";
import {
  monitors,
  qaTicketEvents,
  qaTickets,
  type QaTicket as QaTicketRow,
} from "@shared/db/schema";
import type { Database } from "../db";
import {
  QA_OPEN_STATUSES,
  QA_OVERDUE_AFTER_MINUTES,
  QA_STATUS_TRANSITIONS,
  qaReference,
  qaEvidenceSchema,
  type QaEvidence,
  type QaPublicTicket,
  type QaTicket,
  type QaTicketEvent,
  type QaTicketSource,
  type QaTicketStatus,
  type QaTotals,
} from "@shared/contracts";

const CLOSED_STATUSES: QaTicketStatus[] = ["resolved", "closed"];

export function newReporterToken(): string {
  return randomBytes(16).toString("hex");
}

/**
 * Evidence arrives as a serialised blob. A malformed or oversized capture must
 * never take the ticket list down, so it degrades to `null` instead of throwing.
 */
export function parseEvidence(raw: string | null): QaEvidence | null {
  if (!raw) return null;
  try {
    const parsed = qaEvidenceSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function isClosedStatus(status: QaTicketStatus): boolean {
  return CLOSED_STATUSES.includes(status);
}

/**
 * Transition table check, kept apart from the write so the API can answer 400
 * with the exact reason and the tests can cover it without a database.
 */
export function assertTransition(
  from: QaTicketStatus,
  to: QaTicketStatus
): { allowed: true } | { allowed: false; reason: string } {
  if (from === to) return { allowed: false, reason: "Déjà à cet état" };
  if (QA_STATUS_TRANSITIONS[from].includes(to)) return { allowed: true };
  return {
    allowed: false,
    reason:
      `Transition refusée : ${from} → ${to}. États autorisés : ` +
      (QA_STATUS_TRANSITIONS[from].join(", ") || "aucun (ticket clos)"),
  };
}

export function serializeTicket(
  row: QaTicketRow,
  options: { monitorName: string | null; now: Date }
): QaTicket {
  return {
    id: row.id,
    source: row.source,
    kind: row.kind,
    severity: row.severity,
    status: row.status,
    title: row.title,
    clientMessage: row.clientMessage,
    steps: row.steps,
    expected: row.expected,
    actual: row.actual,
    reporterName: row.reporterName,
    reporterEmail: row.reporterEmail,
    pageUrl: row.pageUrl,
    monitorId: row.monitorId,
    monitorName: options.monitorName,
    evidence: parseEvidence(row.evidence),
    idleMinutes: Math.max(
      0,
      Math.round((options.now.getTime() - row.updatedAt.getTime()) / 60_000)
    ),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    resolvedAt: row.resolvedAt ? row.resolvedAt.toISOString() : null,
  };
}

/**
 * The reporter's own view, built field by field: never the e-mail, the internal
 * notes, the fingerprint or the token. Deriving it by deleting keys from
 * `serializeTicket` would leak the moment a field is added there.
 */
export function serializePublicTicket(
  row: QaTicketRow,
  monitorName: string | null
): QaPublicTicket {
  return {
    id: row.id,
    title: row.title,
    kind: row.kind,
    severity: row.severity,
    status: row.status,
    clientMessage: row.clientMessage,
    steps: row.steps,
    expected: row.expected,
    actual: row.actual,
    pageUrl: row.pageUrl,
    monitorName,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    resolvedAt: row.resolvedAt ? row.resolvedAt.toISOString() : null,
  };
}

export async function monitorNameByIds(
  db: Database,
  ids: number[]
): Promise<Map<number, string>> {
  if (ids.length === 0) return new Map();
  const found = await db
    .select({ id: monitors.id, name: monitors.name })
    .from(monitors)
    .where(inArray(monitors.id, ids));
  return new Map(found.map(row => [row.id, row.name]));
}

/**
 * `updatedAt` doubles as "last activity", so every event write bumps it
 * explicitly: the follow-up rule must count notes, not only status changes.
 */
export async function addTicketEvent(
  db: Database,
  input: {
    ticketId: number;
    author: QaTicketEvent["author"];
    visibility: QaTicketEvent["visibility"];
    body: string;
    fromStatus?: QaTicketStatus | null;
    toStatus?: QaTicketStatus | null;
  }
): Promise<QaTicketEvent> {
  const inserted = await db
    .insert(qaTicketEvents)
    .values({
      ticketId: input.ticketId,
      author: input.author,
      visibility: input.visibility,
      body: input.body.slice(0, 4000),
      fromStatus: input.fromStatus ?? null,
      toStatus: input.toStatus ?? null,
    })
    .execute();
  const id = Number(
    (inserted as unknown as [{ insertId?: number }])[0]?.insertId ?? 0
  );
  await db
    .update(qaTickets)
    .set({ updatedAt: new Date() })
    .where(eq(qaTickets.id, input.ticketId));
  const rows = await db
    .select()
    .from(qaTicketEvents)
    .where(eq(qaTicketEvents.id, id))
    .limit(1);
  const row = rows[0];
  if (!row) throw new Error("Ticket event disappeared after insert");
  return {
    id: row.id,
    author: row.author,
    visibility: row.visibility,
    body: row.body,
    fromStatus: row.fromStatus,
    toStatus: row.toStatus,
    createdAt: row.createdAt.toISOString(),
  };
}

export type NewTicketInput = {
  userId: number;
  source: QaTicketSource;
  kind: QaTicket["kind"];
  severity?: QaTicket["severity"];
  title: string;
  clientMessage: string;
  steps?: string | null;
  expected?: string | null;
  actual?: string | null;
  reporterName?: string | null;
  reporterEmail?: string | null;
  pageUrl?: string | null;
  monitorId?: number | null;
  evidence?: QaEvidence | null;
  fingerprint?: string | null;
  /** Only client reports get a follow-up link; internal and auto ones do not. */
  withReporterToken?: boolean;
};

export async function createTicket(
  db: Database,
  input: NewTicketInput
): Promise<{ row: QaTicketRow; reporterToken: string | null }> {
  const reporterToken = input.withReporterToken ? newReporterToken() : null;
  const inserted = await db
    .insert(qaTickets)
    .values({
      userId: input.userId,
      source: input.source,
      kind: input.kind,
      severity: input.severity ?? "P3",
      status: "new",
      title: input.title,
      clientMessage: input.clientMessage,
      steps: input.steps ?? null,
      expected: input.expected ?? null,
      actual: input.actual ?? null,
      reporterName: input.reporterName ?? null,
      reporterEmail: input.reporterEmail ?? null,
      pageUrl: input.pageUrl ?? null,
      monitorId: input.monitorId ?? null,
      evidence: input.evidence ? JSON.stringify(input.evidence) : null,
      fingerprint: input.fingerprint ?? null,
      reporterToken,
    })
    .execute();
  const id = Number(
    (inserted as unknown as [{ insertId?: number }])[0]?.insertId ?? 0
  );
  const rows = await db.select().from(qaTickets).where(eq(qaTickets.id, id));
  const row = rows[0];
  if (!row) throw new Error("Ticket disappeared after insert");

  await addTicketEvent(db, {
    ticketId: row.id,
    author: input.source === "auto" ? "system" : "client",
    visibility: "public",
    body:
      input.source === "auto"
        ? `Auto-test en échec — attendu : ${row.expected ?? "—"} ; observé : ${row.actual ?? "—"}`
        : `Ticket ${qaReference(row.id)} créé par ${row.reporterName ?? "un visiteur"}.`,
  });
  return { row, reporterToken };
}

/**
 * Anomaly dedupe. A persistent failure updates one ticket instead of opening a
 * new one every pass; a recurrence after resolution becomes visible again
 * because closing clears the fingerprint.
 */
export async function upsertAnomalyTicket(
  db: Database,
  input: NewTicketInput & { fingerprint: string }
): Promise<{ row: QaTicketRow; reopened: boolean }> {
  const existing = await db
    .select()
    .from(qaTickets)
    .where(eq(qaTickets.fingerprint, input.fingerprint))
    .limit(1);
  const row = existing[0];
  if (row && !isClosedStatus(row.status)) {
    await db
      .update(qaTickets)
      .set({
        expected: input.expected ?? row.expected,
        actual: input.actual ?? row.actual,
        evidence: input.evidence
          ? JSON.stringify(input.evidence)
          : row.evidence,
        updatedAt: new Date(),
      })
      .where(eq(qaTickets.id, row.id));
    await addTicketEvent(db, {
      ticketId: row.id,
      author: "system",
      visibility: "internal",
      body: `Anomalie toujours présente — observé : ${input.actual ?? "—"}`,
    });
    return { row, reopened: false };
  }
  const created = await createTicket(db, input);
  return { row: created.row, reopened: true };
}

export async function transitionTicket(
  db: Database,
  row: QaTicketRow,
  to: QaTicketStatus,
  note: string | null
): Promise<QaTicketRow> {
  await db
    .update(qaTickets)
    .set({
      status: to,
      resolvedAt: to === "resolved" ? new Date() : row.resolvedAt,
      // Free the dedupe slot so a later recurrence opens a fresh ticket.
      fingerprint: isClosedStatus(to) ? null : row.fingerprint,
      updatedAt: new Date(),
    })
    .where(eq(qaTickets.id, row.id));
  await addTicketEvent(db, {
    ticketId: row.id,
    author: "support",
    visibility: "public",
    body: note ?? `État changé : ${row.status} → ${to}.`,
    fromStatus: row.status,
    toStatus: to,
  });
  const rows = await db
    .select()
    .from(qaTickets)
    .where(eq(qaTickets.id, row.id))
    .limit(1);
  const updated = rows[0];
  if (!updated) throw new Error("Ticket disappeared after transition");
  return updated;
}

export async function listTickets(
  db: Database,
  userId: number,
  filters: { status?: QaTicketStatus; source?: QaTicketSource } = {},
  now = new Date()
): Promise<QaTicket[]> {
  const conditions = [eq(qaTickets.userId, userId)];
  if (filters.status) conditions.push(eq(qaTickets.status, filters.status));
  if (filters.source) conditions.push(eq(qaTickets.source, filters.source));
  const rows = await db
    .select()
    .from(qaTickets)
    .where(and(...conditions))
    .orderBy(desc(qaTickets.updatedAt))
    .limit(100);
  const names = await monitorNameByIds(db, [
    ...new Set(
      rows.map(row => row.monitorId).filter((id): id is number => id !== null)
    ),
  ]);
  return rows.map(row =>
    serializeTicket(row, {
      monitorName:
        row.monitorId !== null ? (names.get(row.monitorId) ?? null) : null,
      now,
    })
  );
}

export async function ticketEvents(
  db: Database,
  ticketId: number,
  options: { publicOnly: boolean }
): Promise<QaTicketEvent[]> {
  const rows = await db
    .select()
    .from(qaTicketEvents)
    .where(
      options.publicOnly
        ? and(
            eq(qaTicketEvents.ticketId, ticketId),
            eq(qaTicketEvents.visibility, "public")
          )
        : eq(qaTicketEvents.ticketId, ticketId)
    )
    .orderBy(qaTicketEvents.createdAt);
  return rows.map(row => ({
    id: row.id,
    author: row.author,
    visibility: row.visibility,
    body: row.body,
    fromStatus: row.fromStatus,
    toStatus: row.toStatus,
    createdAt: row.createdAt.toISOString(),
  }));
}

/**
 * `userId: null` aggregates every account, which is what the platform-wide
 * daily digest needs; the operator UI always passes a concrete owner.
 */
export async function computeTotals(
  db: Database,
  userId: number | null,
  now = new Date()
): Promise<QaTotals> {
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const overdueBefore = new Date(
    now.getTime() - QA_OVERDUE_AFTER_MINUTES * 60_000
  );
  const rows = await db
    .select({
      status: qaTickets.status,
      source: qaTickets.source,
      updatedAt: qaTickets.updatedAt,
      resolvedAt: qaTickets.resolvedAt,
    })
    .from(qaTickets)
    .where(userId === null ? undefined : eq(qaTickets.userId, userId));

  let open = 0;
  let fresh = 0;
  let waitingClient = 0;
  let autoOpen = 0;
  let resolvedThisWeek = 0;
  let overdue = 0;
  for (const row of rows) {
    if ((QA_OPEN_STATUSES as readonly string[]).includes(row.status)) {
      open += 1;
      if (row.status === "new") fresh += 1;
      if (row.status === "waiting_client") waitingClient += 1;
      if (row.source === "auto") autoOpen += 1;
      if (row.updatedAt < overdueBefore) overdue += 1;
    } else if (
      row.resolvedAt &&
      row.resolvedAt >= weekAgo &&
      row.status === "resolved"
    ) {
      resolvedThisWeek += 1;
    }
  }
  return { open, fresh, waitingClient, autoOpen, resolvedThisWeek, overdue };
}

/** Tickets that have not moved for the follow-up window, stalest first. */
export async function findOverdueTickets(
  db: Database,
  userId: number,
  now = new Date()
): Promise<QaTicketRow[]> {
  const before = new Date(now.getTime() - QA_OVERDUE_AFTER_MINUTES * 60_000);
  const open = await db
    .select()
    .from(qaTickets)
    .where(
      and(
        eq(qaTickets.userId, userId),
        lt(qaTickets.updatedAt, before),
        inArray(qaTickets.status, [...QA_OPEN_STATUSES])
      )
    )
    .orderBy(qaTickets.updatedAt)
    .limit(20);
  return open;
}
