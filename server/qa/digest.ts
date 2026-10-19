import { and, asc, eq, gt, gte, inArray, lt } from "drizzle-orm";
import {
  qaTickets,
  statusPages,
  type QaTicket as QaTicketRow,
} from "@shared/db/schema";
import { getDb, type Database } from "../db";
import {
  QA_OPEN_STATUSES,
  QA_OVERDUE_AFTER_MINUTES,
  publicStatusResponseSchema,
  qaReference,
  type QaDigestResponse,
  type QaRunStatus,
  type QaSelfTestResult,
  type QaTicket,
} from "@shared/contracts";
import { buildPublicStatusPayload } from "../statuspages/analysis";
import { claimRun, finishRun, latestRun, parseDetail } from "./runs";
import { computeTotals, serializeTicket } from "./tickets";

/**
 * The structured daily update the role owes the team: one document per UTC day
 * stating what arrived, what moved, what is stuck, and whether the product
 * still behaves. Generated from the scheduler and stored in `qa_runs`, so it
 * exists even if nobody opens the UI.
 */

const WINDOW_HOURS = 24;
const MAX_LISTED_PER_SECTION = 20;

function dayStart(periodKey: string): Date {
  return new Date(`${periodKey.slice(0, 10)}T00:00:00.000Z`);
}

/** `2026-10-09` — the UTC day a digest belongs to. */
export function digestPeriodKey(now: Date): string {
  return now.toISOString().slice(0, 10);
}

function formatDate(value: Date, withTime = true): string {
  return new Intl.DateTimeFormat("fr-FR", {
    dateStyle: "long",
    ...(withTime ? { timeStyle: "short" } : {}),
    timeZone: "UTC",
  }).format(value);
}

function formatIdle(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  if (minutes < 24 * 60) return `${Math.round(minutes / 60)} h`;
  return `${Math.round(minutes / (24 * 60))} j`;
}

function idleMinutes(row: QaTicketRow, now: Date): number {
  return Math.max(
    0,
    Math.round((now.getTime() - row.updatedAt.getTime()) / 60_000)
  );
}

async function createdSince(db: Database, since: Date): Promise<QaTicketRow[]> {
  return db
    .select()
    .from(qaTickets)
    .where(gt(qaTickets.createdAt, since))
    .orderBy(asc(qaTickets.id))
    .limit(MAX_LISTED_PER_SECTION);
}

async function resolvedSince(
  db: Database,
  since: Date
): Promise<QaTicketRow[]> {
  return db
    .select()
    .from(qaTickets)
    .where(gt(qaTickets.resolvedAt, since))
    .orderBy(asc(qaTickets.id))
    .limit(MAX_LISTED_PER_SECTION);
}

async function staleOpenTickets(db: Database, now: Date): Promise<QaTicket[]> {
  const rows = await db
    .select()
    .from(qaTickets)
    .where(
      and(
        lt(
          qaTickets.updatedAt,
          new Date(now.getTime() - QA_OVERDUE_AFTER_MINUTES * 60_000)
        ),
        inArray(qaTickets.status, [...QA_OPEN_STATUSES])
      )
    )
    .orderBy(asc(qaTickets.updatedAt))
    .limit(MAX_LISTED_PER_SECTION);
  return rows.map(row => serializeTicket(row, { monitorName: null, now }));
}

/** One bullet per ticket, worded so an operator can forward it as-is. */
function ticketBullets(
  rows: QaTicketRow[],
  now: Date,
  empty: string
): string[] {
  if (rows.length === 0) return [`- ${empty}`];
  return rows.map(row => {
    const who = row.reporterName ? ` — ${row.reporterName}` : "";
    return `- **${qaReference(row.id)}** ${row.title} (${row.severity}, ${row.status})${who} — dernière activité ${formatIdle(idleMinutes(row, now))}`;
  });
}

function selfTestSection(results: QaSelfTestResult[]): string[] {
  const failures = results.filter(result => !result.ok);
  if (results.length === 0)
    return ["- Aucun auto-test enregistré sur les dernières 24 heures."];
  if (failures.length === 0)
    return [
      `- ${results.length} invariants de fonctionnement contrôlés, tous conformes.`,
    ];
  return [
    `- ${failures.length} anomalie(s) détectées automatiquement :`,
    ...failures.map(
      result =>
        `  - ${result.label} — attendu : ${result.expected} ; observé : ${result.actual}${
          result.ticketId !== null ? ` (${qaReference(result.ticketId)})` : ""
        }`
    ),
  ];
}

/**
 * Functional test of the public promise: the page a visitor reads must still
 * answer a payload matching the shared contract. It runs once a day rather than
 * every 15 minutes because it performs the full aggregation.
 */
async function publicPageCheck(
  db: Database,
  now: Date
): Promise<{ ok: boolean; line: string }> {
  const pages = await db
    .select()
    .from(statusPages)
    .orderBy(asc(statusPages.id))
    .limit(1);
  if (pages.length === 0)
    return {
      ok: true,
      line: "Aucune page de statut publiée : test fonctionnel public non applicable.",
    };
  try {
    const payload = await buildPublicStatusPayload(db, pages[0], now);
    const parsed = publicStatusResponseSchema.safeParse(payload);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      return {
        ok: false,
        line: `La réponse publique ne correspond plus au contrat partagé${
          issue ? ` (${issue.path.join(".")} : ${issue.message})` : ""
        }.`,
      };
    }
    return {
      ok: true,
      line: `Page « ${payload.title} » : contrat validé sur ${payload.monitors.length} service(s), ${payload.summary.checks24h} vérification(s) sur 24 h.`,
    };
  } catch (error) {
    return {
      ok: false,
      line: `Génération de la page publique impossible : ${error instanceof Error ? error.message : "erreur inconnue"}.`,
    };
  }
}

function nextActionsSection(input: {
  stale: QaTicket[];
  newCount: number;
  autoFailures: number;
  pageOk: boolean;
}): string[] {
  const actions: string[] = [];
  if (!input.pageOk)
    actions.push(
      "Corriger la page publique en priorité : c'est la vue que nos clients partagent."
    );
  if (input.stale.length > 0)
    actions.push(
      `Rappeler ${input.stale.length} client(s) sans nouvelles depuis plus de 48 h (${input.stale
        .slice(0, 5)
        .map(ticket => qaReference(ticket.id))
        .join(", ")}).`
    );
  if (input.newCount > 0)
    actions.push(
      `Trier les ${input.newCount} signalement(s) reçu(s) dans les 24 heures.`
    );
  if (input.autoFailures > 0)
    actions.push(
      "Rejouer les auto-tests après correctif pour confirmer la disparition de l'anomalie."
    );
  if (actions.length === 0)
    actions.push("Aucune action en attente : maintenir la veille quotidienne.");
  return actions.map(action => `- ${action}`);
}

export type BuildDigestOptions = { now?: Date; force?: boolean };

/**
 * Generates the day's digest. Returns null when the UTC day was already
 * claimed, which lets the scheduler call it on every tick for free.
 */
export async function buildDailyDigest(
  db: Database,
  options: BuildDigestOptions = {}
): Promise<QaDigestResponse | null> {
  const now = options.now ?? new Date();
  const date = digestPeriodKey(now);
  const periodKey = options.force
    ? `${date}-m${String(Math.floor(now.getTime() / 1000)).slice(-6)}`
    : date;
  const run = await claimRun(db, "daily_digest", periodKey);
  if (!run) return null;

  const since = new Date(now.getTime() - WINDOW_HOURS * 60 * 60 * 1000);
  const totals = await computeTotals(db, null, now);
  const news = await createdSince(db, since);
  const resolved = await resolvedSince(db, since);
  const stale = await staleOpenTickets(db, now);

  // Only a pass that still belongs to the window proves the current state;
  // an older bucket would report yesterday's anomalies as today's.
  const lastRun = await latestRun(db, "self_test");
  const results =
    lastRun && lastRun.startedAt >= since
      ? parseDetail<QaSelfTestResult>(lastRun.detail)
      : [];
  const autoFailures = results.filter(result => !result.ok).length;
  const autoCount = news.filter(row => row.source === "auto").length;

  const pageCheck = await publicPageCheck(db, now);

  const status: QaRunStatus = !pageCheck.ok
    ? "failed"
    : totals.overdue > 0 || news.length > 0 || autoFailures > 0
      ? "attention"
      : "ok";

  const sections = [
    [
      `# Point qualité du ${formatDate(now, false)}`,
      "",
      `- Couverture : les ${WINDOW_HOURS} dernières heures (UTC), tous comptes confondus.`,
      `- Synthèse : ${
        status === "ok"
          ? "aucun incident qualité"
          : status === "attention"
            ? "suivi nécessaire"
            : "anomalie à corriger"
      }.`,
    ].join("\n"),
    [
      "## Flux du jour",
      "",
      `- Nouveaux signalements : ${news.length} (dont ${autoCount} automatique(s))`,
      `- Résolutions confirmées : ${resolved.length}`,
      `- Tickets ouverts : ${totals.open} (${totals.fresh} non triés, ${totals.waitingClient} en attente client)`,
      `- Suivi dû (aucune activité depuis 48 h) : ${totals.overdue}`,
      `- Résolus sur 7 jours : ${totals.resolvedThisWeek}`,
    ].join("\n"),
    [
      "## Nouveaux signalements",
      "",
      ...ticketBullets(news, now, "Aucun nouveau signalement."),
    ].join("\n"),
    [
      "## Résolutions confirmées",
      "",
      ...ticketBullets(resolved, now, "Aucune résolution confirmée."),
    ].join("\n"),
    [
      "## Relances en attente",
      "",
      ...(stale.length > 0
        ? stale.map(
            ticket =>
              `- **${qaReference(ticket.id)}** ${ticket.title} — silence depuis ${formatIdle(ticket.idleMinutes)} (état ${ticket.status})`
          )
        : ["- Aucun ticket sans nouvelles."]),
    ].join("\n"),
    ["## Auto-tests de fonctionnement", "", ...selfTestSection(results)].join(
      "\n"
    ),
    ["## Test fonctionnel de la page publique", "", `- ${pageCheck.line}`].join(
      "\n"
    ),
    [
      "## Prochaines actions",
      "",
      ...nextActionsSection({
        stale,
        newCount: news.length,
        autoFailures,
        pageOk: pageCheck.ok,
      }),
    ].join("\n"),
  ];

  const markdown = `${sections.join("\n\n")}\n`;
  const summary =
    `${news.length} nouveau(x), ${resolved.length} résolu(s), ` +
    `${totals.overdue} relance(s)${pageCheck.ok ? "" : ", page publique hors contrat"}`;

  await finishRun(db, run.id, { status, summary, detail: markdown });

  return {
    date,
    status,
    markdown,
    totals,
    newCount: news.length,
    resolvedCount: resolved.length,
    autoCount,
    generatedAt: now.toISOString(),
  };
}

/**
 * Replays the newest stored digest. The counters are re-derived from the
 * tickets of that calendar day instead of being read back as zero, so a cached
 * digest never claims a day was quiet when it was not.
 */
export async function lastDailyDigest(
  db: Database
): Promise<QaDigestResponse | null> {
  const run = await latestRun(db, "daily_digest");
  if (!run) return null;
  const start = dayStart(run.periodKey);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  const [created, resolvedRows, autoRows] = await Promise.all([
    db
      .select({ id: qaTickets.id })
      .from(qaTickets)
      .where(
        and(gte(qaTickets.createdAt, start), lt(qaTickets.createdAt, end))
      ),
    db
      .select({ id: qaTickets.id })
      .from(qaTickets)
      .where(
        and(gte(qaTickets.resolvedAt, start), lt(qaTickets.resolvedAt, end))
      ),
    db
      .select({ id: qaTickets.id })
      .from(qaTickets)
      .where(
        and(
          gte(qaTickets.createdAt, start),
          lt(qaTickets.createdAt, end),
          eq(qaTickets.source, "auto")
        )
      ),
  ]);
  return {
    date: run.periodKey.slice(0, 10),
    status: run.status,
    markdown: run.detail ?? "",
    totals: await computeTotals(db, null),
    newCount: created.length,
    resolvedCount: resolvedRows.length,
    autoCount: autoRows.length,
    generatedAt: (run.finishedAt ?? run.startedAt).toISOString(),
  };
}

/** Scheduler entry point: never throws, never blocks the check pass. */
export async function maybeRunDailyDigest(
  now = new Date()
): Promise<QaDigestResponse | null> {
  try {
    const db = await getDb();
    if (!db) return null;
    const digest = await buildDailyDigest(db, { now });
    if (!digest) return null;
    console.log(
      JSON.stringify({
        event: "qa_daily_digest",
        date: digest.date,
        status: digest.status,
        newCount: digest.newCount,
      })
    );
    return digest;
  } catch (error) {
    console.warn(
      JSON.stringify({
        event: "qa_daily_digest_error",
        message: error instanceof Error ? error.message : "digest failed",
      })
    );
    return null;
  }
}
