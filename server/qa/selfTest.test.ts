import { describe, expect, it } from "vitest";
import type { Database } from "../db";
import { QA_TICKET_SEVERITIES } from "@shared/contracts";
import {
  qaOwnerUserId,
  SELF_TEST_CHECKS,
  SELF_TEST_INTERVAL_MINUTES,
  selfTestPeriodKey,
} from "./selfTest";

/**
 * The self-test is the automated half of the "test the features of the
 * application" duty. Its period key is what makes the scheduled pass
 * idempotent, and each check has to answer honestly: an unrunnable check is a
 * failure, never a silent pass.
 */

const NOW = new Date("2026-10-09T12:00:00.000Z");

/**
 * Every drizzle builder chain in these checks ends with `.limit()`, so the
 * stub resolves at that point and hands back one canned row set per call.
 */
function stubDb(responses: unknown[]): Database {
  let index = 0;
  const builder: Record<string, unknown> = {};
  for (const method of ["select", "from", "where", "orderBy"])
    builder[method] = () => builder;
  builder.limit = () => {
    const value = responses[Math.min(index, responses.length - 1)] ?? [];
    index += 1;
    return Promise.resolve(value);
  };
  return builder as unknown as Database;
}

function failingDb(): Database {
  return {
    select() {
      throw new Error("ECONNREFUSED");
    },
  } as unknown as Database;
}

function check(id: string) {
  const found = SELF_TEST_CHECKS.find(entry => entry.id === id);
  if (!found) throw new Error(`invariant inconnue : ${id}`);
  return found;
}

describe("selfTestPeriodKey", () => {
  it("floors the instant onto its UTC bucket", () => {
    expect(selfTestPeriodKey(new Date("2026-10-09T10:00:00.000Z"))).toBe(
      "2026-10-09T10:00"
    );
    expect(selfTestPeriodKey(new Date("2026-10-09T10:14:59.999Z"))).toBe(
      "2026-10-09T10:00"
    );
    expect(selfTestPeriodKey(new Date("2026-10-09T10:17:00.000Z"))).toBe(
      "2026-10-09T10:15"
    );
    expect(selfTestPeriodKey(new Date("2026-10-09T10:45:00.000Z"))).toBe(
      "2026-10-09T10:45"
    );
  });

  it("pads the hour and never crosses UTC midnight", () => {
    expect(selfTestPeriodKey(new Date("2026-10-09T00:07:00.000Z"))).toBe(
      "2026-10-09T00:00"
    );
    expect(selfTestPeriodKey(new Date("2026-10-09T23:59:00.000Z"))).toBe(
      "2026-10-09T23:45"
    );
  });

  it("honours an explicit interval", () => {
    expect(selfTestPeriodKey(new Date("2026-10-09T10:47:00.000Z"), 60)).toBe(
      "2026-10-09T10:00"
    );
  });

  it("keeps the documented fifteen-minute cadence", () => {
    expect(SELF_TEST_INTERVAL_MINUTES).toBe(15);
  });
});

describe("SELF_TEST_CHECKS", () => {
  it("has one entry per invariant, each individually identifiable", () => {
    const ids = SELF_TEST_CHECKS.map(entry => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual([
      "database_reachable",
      "scheduler_alive",
      "first_check_ran",
      "notification_backlog",
      "notification_exhausted",
      "down_without_incident",
      "retention_stalled",
    ]);
  });

  it("states every invariant in French with a bounded severity", () => {
    for (const entry of SELF_TEST_CHECKS) {
      expect(entry.label.trim().length).toBeGreaterThan(0);
      // The two sentences are printed verbatim in the ticket and the report.
      expect(entry.expected.trim().length).toBeGreaterThan(0);
      expect(QA_TICKET_SEVERITIES).toContain(entry.severity);
    }
    const severities = SELF_TEST_CHECKS.map(entry => entry.severity);
    expect(severities.filter(s => s === "P1").length).toBe(3);
  });
});

describe("self-test checks against a stubbed database", () => {
  it("reports a read failure as an anomaly instead of a pass", async () => {
    const outcome = await check("database_reachable").run(failingDb(), NOW);
    expect(outcome.ok).toBe(false);
    expect(outcome.actual).toContain("Erreur de lecture : ECONNREFUSED");
  });

  it("passes when no enabled monitor has a stale schedule", async () => {
    const outcome = await check("scheduler_alive").run(stubDb([[]]), NOW);
    expect(outcome.ok).toBe(true);
    expect(outcome.actual).toBe(
      "Aucun service activé n'a de vérification en retard."
    );
    expect(outcome.findings).toEqual([]);
  });

  it("measures the lateness and attributes it to the owning account", async () => {
    const outcome = await check("scheduler_alive").run(
      stubDb([
        [
          {
            name: "API publique",
            userId: 4,
            nextCheckAt: new Date("2026-10-09T11:50:00.000Z"),
          },
        ],
      ]),
      NOW
    );
    expect(outcome.ok).toBe(false);
    expect(outcome.actual).toBe(
      "1 service activé en attente de vérification hors invariant (API publique : en retard de 10 min)."
    );
    expect(outcome.findings).toEqual([{ userId: 4, subject: "API publique" }]);
  });

  it("shows at most three examples and marks the rest", async () => {
    const outcome = await check("first_check_ran").run(
      stubDb([
        [
          { name: "A" },
          { name: "B" },
          { name: "C" },
          { name: "D" },
          { name: "E" },
        ].map(name => ({ ...name, userId: 1 })),
      ]),
      NOW
    );
    expect(outcome.ok).toBe(false);
    expect(outcome.actual).toContain(
      "5 services sans aucun résultat hors invariant (A ; B ; C…)"
    );
  });

  it("keeps a platform-wide backlog unattributed", async () => {
    const outcome = await check("notification_backlog").run(
      stubDb([[{ id: 12, status: "pending" }]]),
      NOW
    );
    expect(outcome.ok).toBe(false);
    expect(outcome.actual).toBe(
      "1 notification bloquée en file hors invariant (#12 (pending))."
    );
    expect(outcome.findings).toEqual([]);
  });

  it("counts the attempts an exhausted notification burned", async () => {
    const outcome = await check("notification_exhausted").run(
      stubDb([[{ id: 33, attempts: 5 }]]),
      NOW
    );
    expect(outcome.ok).toBe(false);
    expect(outcome.actual).toBe(
      "1 notification épuisée hors invariant (#33 après 5 tentatives)."
    );
  });

  it("only flags a down monitor that has no open incident", async () => {
    const down = [
      { id: 1, name: "API", userId: 1 },
      { id: 2, name: "Site", userId: 2 },
    ];
    const withIncident = await check("down_without_incident").run(
      stubDb([down, [{ monitorId: 1 }, { monitorId: 2 }]]),
      NOW
    );
    expect(withIncident.ok).toBe(true);
    expect(withIncident.actual).toBe(
      "Aucun service en panne ne manque d'incident ouvert."
    );

    const orphaned = await check("down_without_incident").run(
      stubDb([down, [{ monitorId: 1 }]]),
      NOW
    );
    expect(orphaned.ok).toBe(false);
    expect(orphaned.actual).toContain(
      "1 service en panne sans incident ouvert hors invariant (Site)."
    );
    expect(orphaned.findings).toEqual([{ userId: 2, subject: "Site" }]);

    const nothingDown = await check("down_without_incident").run(
      stubDb([[]]),
      NOW
    );
    expect(nothingDown.ok).toBe(true);
    expect(nothingDown.actual).toBe("Aucun service en panne.");
  });

  it("names the cutoff when the retention sweep stopped running", async () => {
    const outcome = await check("retention_stalled").run(
      stubDb([[{ id: 1 }]]),
      NOW
    );
    expect(outcome.ok).toBe(false);
    expect(outcome.actual).toContain(
      "Des relevés antérieurs au 2026-07-09T12:00:00.000Z subsistent : la purge ne s'exécute plus."
    );
    const clean = await check("retention_stalled").run(stubDb([[]]), NOW);
    expect(clean.ok).toBe(true);
    expect(clean.actual).toBe(
      "Aucun relevé au-delà de la fenêtre de rétention."
    );
  });
});

/**
 * The queue needs one account to own platform-wide findings, and under the
 * single-operator lock (ADR-016) that has to be an address able to open a
 * session. The stub answers each bounded query in call order: creator, then
 * first admin, then oldest account.
 */
describe("qaOwnerUserId", () => {
  it("routes to the creator account first", async () => {
    await expect(
      qaOwnerUserId(stubDb([[{ id: 3 }], [{ id: 1 }], []]))
    ).resolves.toBe(3);
  });

  it("falls back to the first admin, then the oldest account", async () => {
    await expect(qaOwnerUserId(stubDb([[], [{ id: 1 }], []]))).resolves.toBe(1);
    await expect(qaOwnerUserId(stubDb([[], [], [{ id: 9 }]]))).resolves.toBe(9);
  });

  it("answers null on an empty base", async () => {
    await expect(qaOwnerUserId(stubDb([[]]))).resolves.toBeNull();
  });
});
