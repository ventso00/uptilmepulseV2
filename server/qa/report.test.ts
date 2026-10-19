import { describe, expect, it } from "vitest";
import type { QaEvidence, QaTicket, QaTicketEvent } from "@shared/contracts";
import { QA_OVERDUE_AFTER_MINUTES } from "@shared/contracts";
import { buildClientReply, buildInternalReport } from "./report";

/**
 * The two generated documents are the deliverables of the QA role: a French
 * internal report for the technical team and a French reply for the client.
 * Both are pure functions of the ticket, so they are worth pinning down —
 * a stray field access would silently print "undefined" inside a document a
 * client reads.
 */

const ORIGIN = "https://statut.uptimepulse.app";
const TOKEN = "0123456789abcdef0123456789abcdef";

function ticket(overrides: Partial<QaTicket> = {}): QaTicket {
  return {
    id: 7,
    source: "client",
    kind: "bug",
    severity: "P2",
    status: "new",
    title: "La page de statut reste vide",
    clientMessage: "Bonjour, ma page de statut n'affiche aucun service.",
    steps: "1. Ouvrir la page\n2. Attendre",
    expected: "Les services avec leur uptime.",
    actual: "Une page vide.",
    reporterName: "Camille",
    reporterEmail: "camille@exemple.fr",
    pageUrl: `${ORIGIN}/status/demo-services`,
    monitorId: null,
    monitorName: null,
    evidence: null,
    idleMinutes: 30,
    createdAt: "2026-10-09T08:00:00.000Z",
    updatedAt: "2026-10-09T08:00:00.000Z",
    resolvedAt: null,
    ...overrides,
  };
}

function event(overrides: Partial<QaTicketEvent> = {}): QaTicketEvent {
  return {
    id: 1,
    author: "support",
    visibility: "public",
    body: "Ticket pris en charge.",
    fromStatus: null,
    toStatus: "triaged",
    createdAt: "2026-10-09T09:00:00.000Z",
    ...overrides,
  };
}

function evidence(overrides: Partial<QaEvidence> = {}): QaEvidence {
  return {
    capturedAt: "2026-10-09T07:55:00.000Z",
    route: "/status/demo-services",
    userAgent: "Mozilla/5.0 (X11; Linux x86_64) Chrome/1.0",
    locale: "fr-FR",
    viewport: { width: 1280, height: 800 },
    javaScriptErrors: [
      {
        message: "Cannot read properties of undefined",
        source: "StatusAnalytics.tsx",
        at: "2026-10-09T07:54:00.000Z",
      },
    ],
    failedRequests: [
      {
        path: "/api/public/status/demo-services",
        status: 500,
        code: "DATABASE_UNAVAILABLE",
        durationMs: 42,
        at: "2026-10-09T07:54:30.000Z",
      },
    ],
    ...overrides,
  };
}

describe("buildInternalReport", () => {
  it("opens with the ticket reference and its French qualification", () => {
    const report = buildInternalReport(ticket(), [], {
      reporterToken: TOKEN,
      origin: ORIGIN,
    });
    expect(
      report.startsWith("# UP-00007 — La page de statut reste vide\n")
    ).toBe(true);
    expect(report).toContain("- Source : Signalé par un client");
    expect(report).toContain("- Domaine : Bug");
    expect(report).toContain("- Sévérité : P2 (Majeur)");
    expect(report).toContain("- État : Nouveau");
    expect(report).toContain("- Dernière activité : il y a 30 min");
    expect(report).toContain("- Résolu le : —");
    expect(report.endsWith("\n")).toBe(true);
  });

  it("keeps the follow-up link out of the report when there is none", () => {
    const withLink = buildInternalReport(ticket(), [], {
      reporterToken: TOKEN,
      origin: ORIGIN,
    });
    expect(withLink).toContain(
      `- Lien de suivi client : ${ORIGIN}/support/${TOKEN}`
    );
    const withoutLink = buildInternalReport(ticket(), [], {
      reporterToken: null,
      origin: ORIGIN,
    });
    expect(withoutLink).not.toContain("Lien de suivi client");
  });

  it("quotes the client verbatim without rewriting their words", () => {
    const report = buildInternalReport(
      ticket({
        clientMessage: "Deux lignes.\nDeuxième ligne.",
      }),
      [],
      { reporterToken: null, origin: ORIGIN }
    );
    expect(report).toContain(
      "## Verbatim du client\n\n> Deux lignes.\n> Deuxième ligne."
    );
  });

  it("names the missing reproduction fields instead of leaving them blank", () => {
    const report = buildInternalReport(
      ticket({ steps: null, expected: "   ", actual: null }),
      [],
      { reporterToken: null, origin: ORIGIN }
    );
    expect(report).toContain("Non fournies — à demander au client.");
    expect(report).toContain("- **Attendu :** Non précisé.");
    expect(report).toContain("- **Réel :** Non précisé.");
  });

  it("renders every captured evidence line", () => {
    const report = buildInternalReport(ticket({ evidence: evidence() }), [], {
      reporterToken: null,
      origin: ORIGIN,
    });
    expect(report).toContain("## Preuves");
    expect(report).toContain(
      "Route au moment du signalement : `/status/demo-services`"
    );
    expect(report).toContain("Fenêtre : 1280×800");
    expect(report).toContain("Langue : fr-FR · capture le");
    expect(report).toContain("Erreurs JavaScript capturées (1) :");
    expect(report).toContain(
      "  - Cannot read properties of undefined `StatusAnalytics.tsx`"
    );
    expect(report).toContain("Appels API en échec (1) :");
    expect(report).toContain(
      "  - /api/public/status/demo-services → 500 (DATABASE_UNAVAILABLE), 42 ms"
    );
  });

  it("says so explicitly when nothing was captured", () => {
    const report = buildInternalReport(
      ticket({
        evidence: evidence({
          javaScriptErrors: [],
          failedRequests: [],
          viewport: null,
        }),
      }),
      [],
      {
        reporterToken: null,
        origin: ORIGIN,
      }
    );
    expect(report).toContain("Aucune erreur JavaScript capturée.");
    expect(report).toContain("Aucun appel API en échec capturé.");
    expect(report).toContain("Fenêtre : —");
    expect(report).not.toContain("Aucune preuve automatique capturée.");

    const bare = buildInternalReport(ticket({ evidence: null }), [], {
      reporterToken: null,
      origin: ORIGIN,
    });
    expect(bare).toContain("Aucune preuve automatique capturée.");
  });

  it("marks internal events as internal in the timeline", () => {
    const report = buildInternalReport(
      ticket(),
      [
        event(),
        event({ id: 2, visibility: "internal", body: "Note interne." }),
      ],
      { reporterToken: null, origin: ORIGIN }
    );
    expect(report).toContain("— Équipe qualité : Ticket pris en charge.");
    expect(report).toContain("(interne) : Note interne.");
    const empty = buildInternalReport(ticket(), [], {
      reporterToken: null,
      origin: ORIGIN,
    });
    expect(empty).toContain("## Chronologie\n\nAucun événement.");
  });

  it("builds a preliminary reading from the signals the ticket carries", () => {
    const technical = buildInternalReport(
      ticket({ evidence: evidence() }),
      [],
      { reporterToken: null, origin: ORIGIN }
    );
    expect(technical).toContain(
      "Le signalement coïncide avec 1 appel(s) API en échec (statuts : 500)."
    );
    expect(technical).toContain("1 erreur(s) JavaScript capturée(s)");

    const auto = buildInternalReport(ticket({ source: "auto" }), [], {
      reporterToken: null,
      origin: ORIGIN,
    });
    expect(auto).toContain("Anomalie détectée par les auto-tests");

    const ergonomic = buildInternalReport(ticket({ kind: "ux" }), [], {
      reporterToken: null,
      origin: ORIGIN,
    });
    expect(ergonomic).toContain(
      "le problème est probablement ergonomique ou visuel"
    );

    const needsSteps = buildInternalReport(ticket({ steps: null }), [], {
      reporterToken: null,
      origin: ORIGIN,
    });
    expect(needsSteps).toContain("modèle « demande de précision »");
  });

  it("aggregates repeated failure statuses rather than repeating them", () => {
    const report = buildInternalReport(
      ticket({
        evidence: evidence({
          javaScriptErrors: [],
          failedRequests: [
            {
              path: "/api/a",
              status: 502,
              code: null,
              durationMs: null,
              at: "2026-10-09T07:50:00.000Z",
            },
            {
              path: "/api/b",
              status: 502,
              code: null,
              durationMs: 10,
              at: "2026-10-09T07:51:00.000Z",
            },
            {
              path: "/api/c",
              status: null,
              code: "ECONNRESET",
              durationMs: null,
              at: "2026-10-09T07:52:00.000Z",
            },
          ],
        }),
      }),
      [],
      { reporterToken: null, origin: ORIGIN }
    );
    expect(report).toContain("(statuts : 502, réseau)");
    expect(report).toContain("  - /api/c → réseau (ECONNRESET)");
    expect(report).toContain("  - /api/b → 502, 10 ms");
    expect(report).toContain("  - /api/b → 502, 10 ms");
  });

  it("falls back to a single honest line when there is no signal", () => {
    const report = buildInternalReport(
      ticket({
        kind: "bug",
        steps: "ok",
        evidence: evidence({ javaScriptErrors: [], failedRequests: [] }),
      }),
      [],
      { reporterToken: null, origin: ORIGIN }
    );
    expect(report).toContain(
      "- Aucun signal exploitable pour l'instant : le ticket doit d'abord être qualifié."
    );
    expect(report).not.toContain("probablement ergonomique");
  });

  it("recommends the state's next action", () => {
    const forStatus = (status: QaTicket["status"]) =>
      buildInternalReport(ticket({ status }), [], {
        reporterToken: null,
        origin: ORIGIN,
      });
    expect(forStatus("new")).toContain(
      "Trier le ticket : confirmer la sévérité et le domaine, puis affecter."
    );
    expect(forStatus("triaged")).toContain(
      "Reproduire à partir des étapes et des preuves capturées."
    );
    expect(forStatus("waiting_client")).toContain(
      "Relancer le client : une précision est en attente de son côté."
    );
    expect(forStatus("closed")).toContain("Aucune action : ticket clos.");
  });

  it("lets the follow-up breach override the state's action", () => {
    const report = buildInternalReport(
      ticket({ status: "closed", idleMinutes: QA_OVERDUE_AFTER_MINUTES }),
      [],
      { reporterToken: null, origin: ORIGIN }
    );
    expect(report).toContain("RELANCE : aucune activité depuis 2 j.");
    expect(report).not.toContain("Aucune action : ticket clos.");
  });

  it("expresses idle time in the unit that reads naturally", () => {
    expect(
      buildInternalReport(ticket({ idleMinutes: 90 }), [], {
        reporterToken: null,
        origin: ORIGIN,
      })
    ).toContain("Dernière activité : il y a 2 h");
    expect(
      buildInternalReport(ticket({ idleMinutes: 2 * 24 * 60 }), [], {
        reporterToken: null,
        origin: ORIGIN,
      })
    ).toContain("Dernière activité : il y a 2 j");
  });
});

describe("buildClientReply", () => {
  const options = { reporterToken: TOKEN, origin: ORIGIN };

  it("acknowledges with the reporter's name and the follow-up link", () => {
    const body = buildClientReply(ticket(), "acknowledgement", options);
    expect(body.startsWith("Bonjour Camille,")).toBe(true);
    expect(body).toContain("Votre signalement UP-00007");
    expect(body).toContain("L'équipe UptimePulse");
    expect(body).toContain(
      `Suivre votre signalement à tout moment : ${ORIGIN}/support/${TOKEN}`
    );
  });

  it("degrades to a neutral greeting and no link for an anonymous ticket", () => {
    const body = buildClientReply(
      ticket({ reporterName: null }),
      "acknowledgement",
      {
        reporterToken: null,
        origin: ORIGIN,
      }
    );
    expect(body.startsWith("Bonjour,")).toBe(true);
    expect(body).not.toContain("Suivre votre signalement");
  });

  it("only mentions automatic evidence when there is some", () => {
    const captured = buildClientReply(
      ticket({ evidence: evidence() }),
      "acknowledgement",
      options
    );
    expect(captured).toContain(
      "Nous avons bien reçu les éléments techniques capturés automatiquement (1 erreur(s) JavaScript, 1 appel(s) API en échec)."
    );
    const plain = buildClientReply(
      ticket({ evidence: null }),
      "acknowledgement",
      options
    );
    expect(plain).not.toContain("éléments techniques capturés");
  });

  it("asks for exactly the fields the ticket is missing", () => {
    const body = buildClientReply(
      ticket({ steps: null, expected: null, actual: null, evidence: null }),
      "clarification",
      options
    );
    expect(body).toContain(
      "il nous manque les étapes que vous avez suivies, une par une, ce que vous attendiez précisément à l'écran, ce que vous avez observé à la place, votre navigateur et la page exacte concernée (une adresse complète suffit)."
    );
  });

  it("does not ask again for what the ticket already holds", () => {
    const body = buildClientReply(
      ticket({
        steps: null,
        expected: "x",
        actual: "y",
        evidence: evidence({ javaScriptErrors: [], failedRequests: [] }),
      }),
      "clarification",
      options
    );
    expect(body).toContain(
      "il nous manque les étapes que vous avez suivies, une par une."
    );
    expect(body).not.toContain("ce que vous attendiez précisément");
    expect(body).not.toContain("votre navigateur et la page exacte concernée");
  });

  it("stays a correct sentence when the ticket is already complete", () => {
    const body = buildClientReply(
      ticket({
        evidence: evidence({ javaScriptErrors: [], failedRequests: [] }),
      }),
      "clarification",
      options
    );
    expect(body).toContain(
      "Votre dossier contient déjà vos étapes et le contexte technique"
    );
    expect(body).not.toContain("il nous manque");
  });

  it("dates the resolution and keeps the door open", () => {
    const dated = buildClientReply(
      ticket({ status: "resolved", resolvedAt: "2026-10-09T12:00:00.000Z" }),
      "resolution",
      options
    );
    expect(dated).toContain("est marqué résolu le");
    expect(dated).toContain("Merci de confirmer");
    const undated = buildClientReply(
      ticket({ status: "resolved", resolvedAt: null }),
      "resolution",
      options
    );
    expect(undated).toContain("est marqué résolu.");
    expect(undated).not.toContain("est marqué résolu le");
  });
});
