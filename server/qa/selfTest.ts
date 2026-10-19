import { and, asc, eq, gte, inArray, isNull, lt, sql } from "drizzle-orm";
import {
  incidents,
  monitors,
  notificationDeliveries,
  pingLogs,
  users,
} from "@shared/db/schema";
import { OWNER_EMAIL } from "../auth/owner";
import { getDb, type Database } from "../db";
import { RETENTION } from "../scheduler/retention";
import {
  qaReference,
  type QaRunStatus,
  type QaSelfTestResult,
  type QaSelfTestRun,
  type QaTicketSeverity,
} from "@shared/contracts";
import { claimRun, finishRun, latestRun, parseDetail } from "./runs";
import { upsertAnomalyTicket } from "./tickets";

/**
 * Automated equivalent of the "test the application's features" duty: a fixed
 * set of invariants about the live system, re-checked on a cadence from inside
 * the scheduler tick.
 *
 * Every check is a read-only aggregate query, so a pass costs a handful of
 * indexed scans. A check whose own query throws is reported as a failure, never
 * as a pass — an unrunnable test is itself an anomaly.
 */
export const SELF_TEST_INTERVAL_MINUTES = 15;

const SCHEDULER_GRACE_MINUTES = 2;
const FIRST_CHECK_GRACE_MINUTES = 15;
const NOTIFICATION_GRACE_MINUTES = 10;
const MAX_ATTEMPTS_BEFORE_EXHAUSTED = 3;
/**
 * The retention sweep deletes `RETENTION.batchSize` rows per tick, so a table
 * that accumulated rows during an outage legitimately takes time to drain.
 * Two days of grace keeps that catch-up from raising a false anomaly.
 */
const RETENTION_GRACE_DAYS = 2;
const MAX_ROWS_PER_CHECK = 20;
const MAX_SAMPLE_SUBJECTS = 3;

type Finding = { userId: number; subject: string };

type CheckOutcome = {
  ok: boolean;
  /** What was observed, with the measured numbers — shown verbatim to humans. */
  actual: string;
  /**
   * Accounts affected by the anomaly. Empty means "system-wide", which is filed
   * under the QA owner.
   */
  findings: Finding[];
};

type SelfTestCheck = {
  id: string;
  label: string;
  /** The invariant in plain French, printed verbatim in the ticket. */
  expected: string;
  severity: QaTicketSeverity;
  run: (db: Database, now: Date) => Promise<CheckOutcome>;
};

function minutesAgo(now: Date, minutes: number): Date {
  return new Date(now.getTime() - minutes * 60_000);
}

function daysAgo(now: Date, days: number): Date {
  return minutesAgo(now, days * 24 * 60);
}

/**
 * Keeps the observation short but concrete: a correctly agreed count then up to
 * three examples. French nouns carry grammatical gender and there is no
 * reliable singular→plural rule, so the caller supplies every form it needs —
 * including the "none" sentence, which has to agree with the noun.
 */
function describe(
  count: number,
  phrases: { none: string; one: string; many: string },
  subjects: string[]
): string {
  if (count === 0) return phrases.none;
  const head =
    count === 1
      ? `1 ${phrases.one} hors invariant`
      : `${count} ${phrases.many} hors invariant`;
  if (subjects.length === 0) return `${head}.`;
  const shown = subjects.slice(0, MAX_SAMPLE_SUBJECTS).join(" ; ");
  return `${head} (${shown}${count > MAX_SAMPLE_SUBJECTS ? "…" : ""}).`;
}

/**
 * System-wide findings have no account attached, so they belong to one QA
 * owner: the creator's own account, else the first admin, else the oldest
 * account. Deterministic, so repeated passes keep updating the same ticket
 * instead of scattering anomalies. The creator comes first because only that
 * address can open a session (ADR-016): routing a ticket to an admin that can
 * no longer sign in would hide an anomaly from the only person who can work it.
 */
export async function qaOwnerUserId(db: Database): Promise<number | null> {
  const creator = await db
    .select({ id: users.id })
    .from(users)
    .where(sql`lower(${users.email}) = ${OWNER_EMAIL}`)
    .orderBy(asc(users.id))
    .limit(1);
  if (creator.length > 0) return creator[0].id;
  const admins = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.role, "admin"))
    .orderBy(asc(users.id))
    .limit(1);
  if (admins.length > 0) return admins[0].id;
  const oldest = await db
    .select({ id: users.id })
    .from(users)
    .orderBy(asc(users.id))
    .limit(1);
  return oldest.length > 0 ? oldest[0].id : null;
}

export const SELF_TEST_CHECKS: SelfTestCheck[] = [
  {
    id: "database_reachable",
    label: "Base de données accessible",
    expected: "une lecture simple des services aboutir",
    severity: "P1",
    async run(db) {
      try {
        const rows = await db
          .select({ id: monitors.id })
          .from(monitors)
          .limit(1);
        return {
          ok: true,
          actual: `Lecture réussie (${rows.length} ligne testée).`,
          findings: [],
        };
      } catch (error) {
        return {
          ok: false,
          actual: `Erreur de lecture : ${error instanceof Error ? error.message : "inconnue"}.`,
          findings: [],
        };
      }
    },
  },
  {
    id: "scheduler_alive",
    label: "Ordonnanceur de vérifications actif",
    expected: `tout service activé dont l'heure de vérification est passée est repris en moins de ${SCHEDULER_GRACE_MINUTES} minutes`,
    severity: "P1",
    async run(db, now) {
      // The atomic claim advances `nextCheckAt`, so a value stuck in the past
      // proves the tick is not running, or dies before the claim.
      const rows = await db
        .select({
          name: monitors.name,
          userId: monitors.userId,
          nextCheckAt: monitors.nextCheckAt,
        })
        .from(monitors)
        .where(
          and(
            eq(monitors.enabled, true),
            lt(monitors.nextCheckAt, minutesAgo(now, SCHEDULER_GRACE_MINUTES))
          )
        )
        .orderBy(asc(monitors.nextCheckAt))
        .limit(MAX_ROWS_PER_CHECK);
      const overdueMinutes = (value: Date) =>
        Math.round((now.getTime() - value.getTime()) / 60_000);
      return {
        ok: rows.length === 0,
        actual: describe(
          rows.length,
          {
            none: "Aucun service activé n'a de vérification en retard.",
            one: "service activé en attente de vérification",
            many: "services activés en attente de vérification",
          },
          rows.map(
            row =>
              `${row.name} : en retard de ${overdueMinutes(row.nextCheckAt)} min`
          )
        ),
        findings: rows.map(row => ({ userId: row.userId, subject: row.name })),
      };
    },
  },
  {
    id: "first_check_ran",
    label: "Première vérification exécutée",
    expected: `un service activé obtient un premier résultat en moins de ${FIRST_CHECK_GRACE_MINUTES} minutes`,
    severity: "P2",
    async run(db, now) {
      const rows = await db
        .select({ name: monitors.name, userId: monitors.userId })
        .from(monitors)
        .where(
          and(
            eq(monitors.enabled, true),
            isNull(monitors.lastCheckAt),
            eq(monitors.currentStatus, "UNKNOWN"),
            lt(monitors.createdAt, minutesAgo(now, FIRST_CHECK_GRACE_MINUTES))
          )
        )
        .orderBy(asc(monitors.createdAt))
        .limit(MAX_ROWS_PER_CHECK);
      return {
        ok: rows.length === 0,
        actual: describe(
          rows.length,
          {
            none: "Aucun service activé n'est dépourvu de résultat.",
            one: "service sans aucun résultat",
            many: "services sans aucun résultat",
          },
          rows.map(row => row.name)
        ),
        findings: rows.map(row => ({ userId: row.userId, subject: row.name })),
      };
    },
  },
  {
    id: "notification_backlog",
    label: "File de notification fluide",
    expected: `une notification en attente ou en échec est reprise en moins de ${NOTIFICATION_GRACE_MINUTES} minutes`,
    severity: "P2",
    async run(db, now) {
      const rows = await db
        .select({
          id: notificationDeliveries.id,
          status: notificationDeliveries.status,
        })
        .from(notificationDeliveries)
        .where(
          and(
            inArray(notificationDeliveries.status, ["pending", "failed"]),
            lt(
              notificationDeliveries.updatedAt,
              minutesAgo(now, NOTIFICATION_GRACE_MINUTES)
            )
          )
        )
        .limit(MAX_ROWS_PER_CHECK);
      return {
        ok: rows.length === 0,
        actual: describe(
          rows.length,
          {
            none: "Aucune notification n'est bloquée en file.",
            one: "notification bloquée en file",
            many: "notifications bloquées en file",
          },
          rows.map(row => `#${row.id} (${row.status})`)
        ),
        // Deliveries carry no user id; resolving the owner through the incident
        // would need a join per channel. The queue is a platform concern, so it
        // is filed as one system-wide ticket for the QA owner.
        findings: [],
      };
    },
  },
  {
    id: "notification_exhausted",
    label: "Tentatives de notification épuisées",
    expected: `aucune notification n'accumule ${MAX_ATTEMPTS_BEFORE_EXHAUSTED} tentatives échouées sans traitement manuel`,
    severity: "P3",
    async run(db) {
      const rows = await db
        .select({
          id: notificationDeliveries.id,
          attempts: notificationDeliveries.attempts,
        })
        .from(notificationDeliveries)
        .where(
          and(
            eq(notificationDeliveries.status, "failed"),
            gte(notificationDeliveries.attempts, MAX_ATTEMPTS_BEFORE_EXHAUSTED)
          )
        )
        .limit(MAX_ROWS_PER_CHECK);
      return {
        ok: rows.length === 0,
        actual: describe(
          rows.length,
          {
            none: "Aucune notification n'est épuisée.",
            one: "notification épuisée",
            many: "notifications épuisées",
          },
          rows.map(row => `#${row.id} après ${row.attempts} tentatives`)
        ),
        findings: [],
      };
    },
  },
  {
    id: "down_without_incident",
    label: "Incident ouvert pour chaque service en panne",
    expected:
      "tout service marqué en panne possède un incident non résolu dans l'historique",
    severity: "P1",
    async run(db) {
      const down = await db
        .select({
          id: monitors.id,
          name: monitors.name,
          userId: monitors.userId,
        })
        .from(monitors)
        .where(
          and(eq(monitors.enabled, true), eq(monitors.currentStatus, "DOWN"))
        )
        .limit(100);
      if (down.length === 0)
        return { ok: true, actual: "Aucun service en panne.", findings: [] };
      const open = await db
        .select({ monitorId: incidents.monitorId })
        .from(incidents)
        .where(
          and(
            inArray(
              incidents.monitorId,
              down.map(row => row.id)
            ),
            inArray(incidents.status, ["suspect", "confirmed"])
          )
        )
        .limit(100);
      const withIncident = new Set(open.map(row => row.monitorId));
      const orphans = down.filter(row => !withIncident.has(row.id));
      return {
        ok: orphans.length === 0,
        actual: describe(
          orphans.length,
          {
            none: "Aucun service en panne ne manque d'incident ouvert.",
            one: "service en panne sans incident ouvert",
            many: "services en panne sans incident ouvert",
          },
          orphans.map(row => row.name)
        ),
        findings: orphans.map(row => ({
          userId: row.userId,
          subject: row.name,
        })),
      };
    },
  },
  {
    id: "retention_stalled",
    label: "Purge de rétention à jour",
    expected: `aucun relevé conservé au-delà de ${RETENTION.pingLogsDays + RETENTION_GRACE_DAYS} jours`,
    severity: "P3",
    async run(db, now) {
      const cutoff = daysAgo(
        now,
        RETENTION.pingLogsDays + RETENTION_GRACE_DAYS
      );
      const rows = await db
        .select({ id: pingLogs.id })
        .from(pingLogs)
        .where(lt(pingLogs.checkedAt, cutoff))
        .limit(1);
      return {
        ok: rows.length === 0,
        actual:
          rows.length === 0
            ? "Aucun relevé au-delà de la fenêtre de rétention."
            : `Des relevés antérieurs au ${cutoff.toISOString()} subsistent : la purge ne s'exécute plus.`,
        findings: [],
      };
    },
  },
];

/** `2026-10-09T10:15` — the 15-minute UTC bucket a pass belongs to. */
export function selfTestPeriodKey(
  now: Date,
  intervalMinutes = SELF_TEST_INTERVAL_MINUTES
): string {
  const floored =
    Math.floor(now.getUTCMinutes() / intervalMinutes) * intervalMinutes;
  const hh = String(now.getUTCHours()).padStart(2, "0");
  const mm = String(floored).padStart(2, "0");
  return `${now.toISOString().slice(0, 11)}${hh}:${mm}`;
}

/** P1 failures mean the product itself is wrong; anything else needs triage. */
function statusFrom(failures: QaSelfTestResult[]): QaRunStatus {
  if (failures.length === 0) return "ok";
  return failures.some(result => result.severity === "P1")
    ? "failed"
    : "attention";
}

/**
 * Opens or refreshes one ticket per (check, account) pair: a check that sees
 * five stalled monitors of the same owner produces one ticket, not five.
 */
async function fileAnomaly(
  db: Database,
  check: SelfTestCheck,
  outcome: CheckOutcome,
  ownerUserId: number | null
): Promise<number | null> {
  if (outcome.ok) return null;

  const groups = new Map<number, string[]>();
  for (const finding of outcome.findings) {
    const list = groups.get(finding.userId) ?? [];
    list.push(finding.subject);
    groups.set(finding.userId, list);
  }
  if (groups.size === 0) {
    if (ownerUserId === null) return null;
    groups.set(ownerUserId, []);
  }

  let firstTicketId: number | null = null;
  for (const [userId, subjects] of groups) {
    // The fingerprint column is globally unique, so the account must be part of
    // the key: two owners failing the same check are two distinct anomalies.
    const scope =
      subjects.length === 0
        ? "portée système"
        : subjects.length === 1
          ? subjects[0]
          : `${subjects.length} services`;
    const { row } = await upsertAnomalyTicket(db, {
      userId,
      source: "auto",
      kind: "behaviour",
      severity: check.severity,
      title: `${check.label} — ${scope}`.slice(0, 160),
      clientMessage:
        `L'auto-test « ${check.label} » a détecté une anomalie de fonctionnement. ` +
        `Ce ticket est ouvert automatiquement par la surveillance interne du produit, ` +
        `sans intervention humaine.`,
      steps:
        subjects.length > 0
          ? `Services concernés : ${subjects.join(", ")}.`
          : "Aucun service identifié : anomalie système.",
      expected: check.expected,
      actual: outcome.actual,
      fingerprint: `selftest:${check.id}:u${userId}`,
    });
    if (firstTicketId === null) firstTicketId = row.id;
  }
  return firstTicketId;
}

export type RunSelfTestOptions = {
  now?: Date;
  /** Manual runs bypass the 15-minute claim so an operator can force a pass. */
  force?: boolean;
};

/**
 * One pass over every invariant. Returns null when the period was already
 * claimed, which lets the scheduler call it on every tick for free.
 */
export async function runSelfTest(
  db: Database,
  options: RunSelfTestOptions = {}
): Promise<QaSelfTestRun | null> {
  const now = options.now ?? new Date();
  const periodKey = options.force
    ? `${selfTestPeriodKey(now)}-m${String(Math.floor(now.getTime() / 1000)).slice(-6)}`
    : selfTestPeriodKey(now);
  const run = await claimRun(db, "self_test", periodKey);
  if (!run) return null;

  const ownerUserId = await qaOwnerUserId(db);
  const results: QaSelfTestResult[] = [];

  for (const check of SELF_TEST_CHECKS) {
    let outcome: CheckOutcome;
    try {
      outcome = await check.run(db, now);
    } catch (error) {
      outcome = {
        ok: false,
        actual: `Test impossible : ${error instanceof Error ? error.message : "erreur inconnue"}.`,
        findings: [],
      };
    }
    // A ticket-write failure must not lose the rest of the pass, but it must
    // not turn the anomaly green either.
    const ticketId = await fileAnomaly(db, check, outcome, ownerUserId).catch(
      error => {
        console.warn(
          JSON.stringify({
            event: "qa_self_test_ticket_error",
            checkId: check.id,
            message: error instanceof Error ? error.message : "unknown",
          })
        );
        return null;
      }
    );
    results.push({
      id: check.id,
      label: check.label,
      ok: outcome.ok,
      expected: check.expected,
      actual: outcome.actual,
      severity: check.severity,
      ticketId,
    });
  }

  const failures = results.filter(result => !result.ok);
  const references = failures
    .filter(result => result.ticketId !== null)
    .map(result => qaReference(result.ticketId as number));
  const summary =
    failures.length === 0
      ? `${results.length}/${results.length} invariants vérifiés`
      : `${failures.length} anomalie(s) sur ${results.length} invariants${
          references.length > 0 ? ` (${references.join(", ")})` : ""
        }`;
  const status = statusFrom(failures);

  await finishRun(db, run.id, {
    status,
    summary,
    detail: JSON.stringify(results),
  });

  return {
    periodKey,
    status,
    startedAt: run.startedAt.toISOString(),
    finishedAt: new Date().toISOString(),
    results,
  };
}

export async function lastSelfTestRun(
  db: Database
): Promise<QaSelfTestRun | null> {
  const run = await latestRun(db, "self_test");
  if (!run) return null;
  return {
    periodKey: run.periodKey,
    status: run.status,
    startedAt: run.startedAt.toISOString(),
    finishedAt: run.finishedAt ? run.finishedAt.toISOString() : null,
    results: parseDetail<QaSelfTestResult>(run.detail),
  };
}

/** Scheduler entry point: never throws, never blocks the check pass. */
export async function maybeRunSelfTest(
  now = new Date()
): Promise<QaSelfTestRun | null> {
  try {
    const db = await getDb();
    if (!db) return null;
    const run = await runSelfTest(db, { now });
    if (!run) return null;
    console.log(
      JSON.stringify({
        event: "qa_self_test",
        periodKey: run.periodKey,
        status: run.status,
        failures: run.results.filter(result => !result.ok).length,
      })
    );
    return run;
  } catch (error) {
    console.warn(
      JSON.stringify({
        event: "qa_self_test_error",
        message: error instanceof Error ? error.message : "self test failed",
      })
    );
    return null;
  }
}
