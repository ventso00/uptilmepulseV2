import {
  QA_OPEN_STATUSES,
  QA_OVERDUE_AFTER_MINUTES,
  qaTicketSeverityLabels,
  qaTicketStatusLabels,
  type QaTicketSeverity,
  type QaTicketStatus,
} from "@shared/contracts";

/**
 * Severity and status are the two axes an operator reads first, so both are
 * colour-coded here once: the queue, the ticket detail and the reporter's
 * follow-up page cannot drift apart on what "P1" or "Résolu" looks like.
 */

/**
 * Every chip is built from semantic tokens, never a literal palette colour:
 * the same chip must stay legible on the light reporter page and on the dark
 * operator queue without forking the styles per route.
 */
const severityStyles: Record<QaTicketSeverity, string> = {
  P1: "border-state-down/30 bg-state-down/10 text-state-down",
  P2: "border-state-warn/30 bg-state-warn/10 text-state-warn",
  P3: "border-brand/30 bg-brand/10 text-brand",
  P4: "border-line bg-surface-2 text-ink-muted",
};

const statusStyles: Record<QaTicketStatus, string> = {
  new: "border-state-warn/30 bg-state-warn/10 text-state-warn",
  triaged: "border-brand/30 bg-brand/10 text-brand",
  in_progress: "border-brand/40 bg-brand/15 text-brand",
  // Dashed border: "we are waiting on you" has to be readable without colour.
  waiting_client:
    "border-ink-muted/45 border-dashed bg-surface-2 text-ink-soft",
  resolved: "border-state-up/30 bg-state-up/10 text-state-up",
  closed: "border-line bg-surface-2 text-ink-muted",
};

function Chip({
  className,
  children,
}: {
  className: string;
  children: React.ReactNode;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium ${className}`}
    >
      {children}
    </span>
  );
}

export function SeverityChip({ severity }: { severity: QaTicketSeverity }) {
  return (
    <Chip className={severityStyles[severity]}>
      {severity} · {qaTicketSeverityLabels[severity]}
    </Chip>
  );
}

export function StatusChip({ status }: { status: QaTicketStatus }) {
  return (
    <Chip className={statusStyles[status]}>{qaTicketStatusLabels[status]}</Chip>
  );
}

/**
 * How long the ticket has been silent. Colour alone must not carry the breach,
 * so callers pair this with the "relance en retard" wording.
 */
export function idleLabel(minutes: number): string {
  if (minutes < 1) return "à l’instant";
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h`;
  return `${Math.floor(hours / 24)} j`;
}

export function isOverdue(
  status: QaTicketStatus,
  idleMinutes: number
): boolean {
  const open: QaTicketStatus[] = [...QA_OPEN_STATUSES];
  return open.includes(status) && idleMinutes >= QA_OVERDUE_AFTER_MINUTES;
}

export function formatDateTimeFr(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("fr-FR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(date);
}
