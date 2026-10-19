import {
  QA_OVERDUE_AFTER_MINUTES,
  qaReference,
  qaTicketEventAuthorLabels,
  qaTicketKindLabels,
  qaTicketSeverityLabels,
  qaTicketSourceLabels,
  qaTicketStatusLabels,
  type QaEvidence,
  type QaTicket,
  type QaTicketEvent,
} from "@shared/contracts";

/**
 * The two documents the role produced by hand: a French internal report for the
 * technical team, and a French reply for the client. Both are pure functions of
 * the ticket, so they can be regenerated at any time and stay auditable — and
 * neither may state anything the ticket does not carry.
 */

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("fr-FR", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(new Date(value));
}

/** `30 min` / `2 h` / `2 j` — the bare duration, for "depuis …" sentences. */
function duration(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  if (minutes < 24 * 60) return `${Math.round(minutes / 60)} h`;
  return `${Math.round(minutes / (24 * 60))} j`;
}

function formatIdle(minutes: number): string {
  return `il y a ${duration(minutes)}`;
}

function orMissing(value: string | null, missing: string): string {
  return value && value.trim().length > 0 ? value.trim() : missing;
}

function describeEvidence(evidence: QaEvidence | null): string[] {
  if (!evidence) return ["Aucune preuve automatique capturée."];
  const lines = [
    `Route au moment du signalement : \`${evidence.route}\``,
    `Navigateur : ${evidence.userAgent}`,
    `Fenêtre : ${evidence.viewport ? `${evidence.viewport.width}×${evidence.viewport.height}` : "—"}`,
    `Langue : ${evidence.locale} · capture le ${formatDate(evidence.capturedAt)}`,
  ];
  if (evidence.javaScriptErrors.length > 0) {
    lines.push(
      `Erreurs JavaScript capturées (${evidence.javaScriptErrors.length}) :`
    );
    for (const error of evidence.javaScriptErrors)
      lines.push(
        `  - ${error.message} \`${error.source}\` (${formatDate(error.at)})`
      );
  } else {
    lines.push("Aucune erreur JavaScript capturée.");
  }
  if (evidence.failedRequests.length > 0) {
    lines.push(`Appels API en échec (${evidence.failedRequests.length}) :`);
    for (const call of evidence.failedRequests)
      lines.push(
        `  - ${call.path} → ${call.status ?? "réseau"}${call.code ? ` (${call.code})` : ""}${call.durationMs !== null ? `, ${call.durationMs} ms` : ""} (${formatDate(call.at)})`
      );
  } else {
    lines.push("Aucun appel API en échec capturé.");
  }
  return lines;
}

/**
 * A first reading of the report, built only from what the ticket contains. It
 * deliberately stops at "what the data points to" and never asserts a cause.
 */
function preliminaryReading(ticket: QaTicket): string[] {
  const lines: string[] = [];
  const evidence = ticket.evidence;
  if (ticket.source === "auto") {
    lines.push(
      "Anomalie détectée par les auto-tests : l'invariant mesuré est reproductible sans intervention humaine, la cause est donc soit dans les données soit dans le scheduler."
    );
  }
  if (evidence && evidence.failedRequests.length > 0) {
    const codes = [
      ...new Set(
        evidence.failedRequests.map(call => String(call.status ?? "réseau"))
      ),
    ];
    lines.push(
      `Le signalement coïncide avec ${evidence.failedRequests.length} appel(s) API en échec (statuts : ${codes.join(", ")}). Vérifier d'abord ces routes côté serveur.`
    );
  }
  if (evidence && evidence.javaScriptErrors.length > 0) {
    lines.push(
      `${evidence.javaScriptErrors.length} erreur(s) JavaScript capturée(s) : la relecture des messages indique s'il s'agit d'un plantage de rendu ou d'une dépendance externe.`
    );
  }
  if (
    ticket.kind === "ux" &&
    (!evidence ||
      (evidence.javaScriptErrors.length === 0 &&
        evidence.failedRequests.length === 0))
  ) {
    lines.push(
      "Aucune erreur technique capturée : le problème est probablement ergonomique ou visuel, à reproduire en session sur la route indiquée."
    );
  }
  if (!ticket.steps)
    lines.push(
      "Étapes de reproduction absentes : demander au client avant toute investigation (modèle « demande de précision »)."
    );
  if (lines.length === 0)
    lines.push(
      "Aucun signal exploitable pour l'instant : le ticket doit d'abord être qualifié."
    );
  return lines;
}

function recommendedNextStep(ticket: QaTicket): string {
  if (ticket.idleMinutes >= QA_OVERDUE_AFTER_MINUTES)
    return `RELANCE : aucune activité depuis ${duration(ticket.idleMinutes)}. Un suivi est dû au client.`;
  switch (ticket.status) {
    case "new":
      return "Trier le ticket : confirmer la sévérité et le domaine, puis affecter.";
    case "triaged":
      return "Reproduire à partir des étapes et des preuves capturées.";
    case "in_progress":
      return "Continuer l'investigation et publier une note publique d'avancement.";
    case "waiting_client":
      return "Relancer le client : une précision est en attente de son côté.";
    case "resolved":
      return "Confirmer la résolution avec le client puis closre.";
    default:
      return "Aucune action : ticket clos.";
  }
}

export function buildInternalReport(
  ticket: QaTicket,
  events: QaTicketEvent[],
  options: { reporterToken: string | null; origin: string }
): string {
  const sections: string[] = [];
  const reference = qaReference(ticket.id);

  sections.push(
    [
      `# ${reference} — ${ticket.title}`,
      "",
      `- Source : ${qaTicketSourceLabels[ticket.source]}`,
      `- Domaine : ${qaTicketKindLabels[ticket.kind]}`,
      `- Sévérité : ${ticket.severity} (${qaTicketSeverityLabels[ticket.severity]})`,
      `- État : ${qaTicketStatusLabels[ticket.status]}`,
      `- Créé le : ${formatDate(ticket.createdAt)}`,
      `- Dernière activité : ${formatIdle(ticket.idleMinutes)}`,
      ticket.resolvedAt
        ? `- Résolu le : ${formatDate(ticket.resolvedAt)}`
        : "- Résolu le : —",
      ticket.monitorName ? `- Service concerné : ${ticket.monitorName}` : null,
      ticket.pageUrl ? `- Page concernée : ${ticket.pageUrl}` : null,
      options.reporterToken
        ? `- Lien de suivi client : ${options.origin}/support/${options.reporterToken}`
        : null,
    ]
      .filter((line): line is string => line !== null)
      .join("\n")
  );

  sections.push(
    [
      "## Verbatim du client",
      "",
      `> ${ticket.clientMessage.replace(/\n/g, "\n> ")}`,
    ].join("\n")
  );

  sections.push(
    [
      "## Étapes de reproduction",
      "",
      orMissing(ticket.steps, "Non fournies — à demander au client."),
    ].join("\n")
  );

  sections.push(
    [
      "## Attendu vs réel",
      "",
      `- **Attendu :** ${orMissing(ticket.expected, "Non précisé.")}`,
      `- **Réel :** ${orMissing(ticket.actual, "Non précisé.")}`,
    ].join("\n")
  );

  sections.push(
    ["## Preuves", "", ...describeEvidence(ticket.evidence)].join("\n")
  );

  sections.push(
    [
      "## Chronologie",
      "",
      ...(events.length > 0
        ? events.map(
            event =>
              `- ${formatDate(event.createdAt)} — ${qaTicketEventAuthorLabels[event.author]}${event.visibility === "internal" ? " (interne)" : ""} : ${event.body}`
          )
        : ["Aucun événement."]),
    ].join("\n")
  );

  sections.push(
    [
      "## Lecture préliminaire",
      "",
      ...preliminaryReading(ticket).map(line => `- ${line}`),
    ].join("\n")
  );

  sections.push(
    ["## Prochaine action", "", recommendedNextStep(ticket)].join("\n")
  );

  return `${sections.join("\n\n")}\n`;
}

const GREETING = (name: string | null) =>
  name ? `Bonjour ${name},` : "Bonjour,";

/**
 * Client-facing templates. They only restate what the ticket knows and never
 * promise a date, a version, or a cause.
 */
export function buildClientReply(
  ticket: QaTicket,
  kind: "acknowledgement" | "clarification" | "resolution",
  options: { reporterToken: string | null; origin: string }
): string {
  const reference = qaReference(ticket.id);
  const link = options.reporterToken
    ? `\n\nSuivre votre signalement à tout moment : ${options.origin}/support/${options.reporterToken}`
    : "";
  const evidence = ticket.evidence;
  const captured =
    evidence &&
    (evidence.javaScriptErrors.length > 0 || evidence.failedRequests.length > 0)
      ? ` Nous avons bien reçu les éléments techniques capturés automatiquement (${evidence.javaScriptErrors.length} erreur(s) JavaScript, ${evidence.failedRequests.length} appel(s) API en échec).`
      : "";

  if (kind === "acknowledgement")
    return `${GREETING(ticket.reporterName)}

Votre signalement ${reference} — « ${ticket.title} » — est enregistré et pris en charge par notre équipe qualité. Nous le relisons et travaillons à le reproduire.${captured}

Nous revenons vers vous dès que nous avons une réponse concrète.

Cordialement,
L'équipe UptimePulse${link}`;

  if (kind === "clarification") {
    const missing: string[] = [];
    if (!ticket.steps)
      missing.push("les étapes que vous avez suivies, une par une");
    if (!ticket.expected)
      missing.push("ce que vous attendiez précisément à l'écran");
    if (!ticket.actual) missing.push("ce que vous avez observé à la place");
    if (!ticket.evidence)
      missing.push(
        "votre navigateur et la page exacte concernée (une adresse complète suffit)"
      );
    // The operator picks this template by hand, so it has to stay correct when
    // the ticket is already complete: naming nothing would print "il nous
    // manque ." to a client.
    const ask =
      missing.length > 0
        ? `Pour le reproduire et le corriger, il nous manque ${missing.join(", ")}.`
        : "Votre dossier contient déjà vos étapes et le contexte technique : nous reproduisons de notre côté et vous revenons vers vous.";
    return `${GREETING(ticket.reporterName)}

Nous avons bien ouvert le signalement ${reference} — « ${ticket.title} ». ${ask}

Vous pouvez répondre directement ici ou depuis votre lien de suivi ; nous reprenons l'analyse dès réception.

Cordialement,
L'équipe UptimePulse${link}`;
  }

  return `${GREETING(ticket.reporterName)}

Le signalement ${reference} — « ${ticket.title} » — est marqué résolu${ticket.resolvedAt ? ` le ${formatDate(ticket.resolvedAt)}` : ""}. Merci de confirmer que le comportement constaté correspond désormais à ce que vous attendiez : sans retour de votre part nous gardons le dossier ouvert.

Cordialement,
L'équipe UptimePulse${link}`;
}
