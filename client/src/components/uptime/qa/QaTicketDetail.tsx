import {
  AlertTriangle,
  ArrowLeft,
  Check,
  ClipboardCopy,
  Clock3,
  FileText,
  Link2,
  Loader2,
  MessageSquareText,
  Paperclip,
  Send,
  ShieldAlert,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { api, errorMessage, type QaTicketDetailResponse } from "@/lib/api";
import {
  QA_STATUS_TRANSITIONS,
  QA_TICKET_SEVERITIES,
  qaReference,
  qaTicketEventAuthorLabels,
  qaTicketKindLabels,
  qaTicketSeverityLabels,
  qaTicketSourceLabels,
  qaTicketStatusLabels,
  type QaReplyTemplate,
  type QaTicketKind,
  type QaTicketSeverity,
} from "@shared/contracts";
import { ErrorState } from "../PageState";
import {
  SeverityChip,
  StatusChip,
  formatDateTimeFr,
  idleLabel,
  isOverdue,
} from "./QaChips";

function Section({
  title,
  icon: Icon,
  children,
}: {
  title: string;
  icon: typeof FileText;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-line bg-surface p-5 shadow-soft">
      <h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-ink-muted">
        <Icon className="h-3.5 w-3.5 text-brand-glow" aria-hidden="true" />
        {title}
      </h3>
      <div className="mt-4 space-y-3">{children}</div>
    </section>
  );
}

function Line({ label, value }: { label: string; value: string | null }) {
  if (!value) return null;
  return (
    <div>
      <p className="text-[11px] uppercase tracking-[0.14em] text-ink-muted">
        {label}
      </p>
      <p className="mt-1 text-sm leading-6 whitespace-pre-wrap text-ink">
        {value}
      </p>
    </div>
  );
}

function CopyButton({
  value,
  label,
  disabled,
}: {
  value: string;
  label: string;
  disabled?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => {
        void navigator.clipboard
          .writeText(value)
          .then(() => setCopied(true))
          .catch(() => setCopied(false));
      }}
      className="inline-flex items-center gap-1.5 rounded-full border border-line px-3 py-1.5 text-xs text-ink-soft hover:bg-surface-2 disabled:opacity-50"
    >
      {copied ? (
        <Check className="h-3.5 w-3.5 text-state-up" aria-hidden="true" />
      ) : (
        <ClipboardCopy className="h-3.5 w-3.5" aria-hidden="true" />
      )}
      {copied ? "Copié" : label}
    </button>
  );
}

/**
 * The operator workbench for one ticket: the client's own words first, then the
 * reproduction and evidence, then the actions that move it forward. Every
 * mutation reloads the detail from the API instead of patching local state, so
 * what is on screen is always what the server validated.
 */
export function QaTicketDetail({
  ticketId,
  onBack,
  onQueueChanged,
}: {
  ticketId: number;
  onBack: () => void;
  onQueueChanged: () => void;
}) {
  const [detail, setDetail] = useState<QaTicketDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [actionError, setActionError] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [noteVisibility, setNoteVisibility] = useState<"public" | "internal">(
    "internal"
  );
  const [draft, setDraft] = useState<QaReplyTemplate | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setDetail(await api.qaTicket(ticketId));
      setLoadError("");
    } catch (cause) {
      setLoadError(errorMessage(cause, "Ticket introuvable"));
    } finally {
      setLoading(false);
    }
  }, [ticketId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setActionError("");
    try {
      await action();
    } catch (cause) {
      setActionError(errorMessage(cause, "Action impossible"));
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <p className="flex items-center gap-2 text-sm text-ink-muted">
        <Loader2 className="h-4 w-4 animate-spin text-brand-glow" />
        Ouverture du ticket…
      </p>
    );
  }
  if (!detail) {
    return (
      <ErrorState
        title="Ticket indisponible"
        message={loadError}
        onRetry={() => void load()}
      />
    );
  }

  const { ticket, events, reporterToken, internalReport } = detail;
  const overdue = isOverdue(ticket.status, ticket.idleMinutes);
  const followUpLink = reporterToken
    ? `${window.location.origin}/support/${reporterToken}`
    : null;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <button
          onClick={onBack}
          className="inline-flex items-center gap-2 rounded-full border border-line px-3 py-2 text-sm text-ink-soft hover:bg-surface-2"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Retour à la file
        </button>
        <CopyButton value={internalReport} label="Copier le rapport interne" />
      </div>

      <header className="rounded-2xl border border-line bg-surface p-6 shadow-soft">
        <p className="font-mono text-xs text-brand-glow">
          {qaReference(ticket.id)}
        </p>
        <h2 className="mt-2 text-xl font-semibold text-ink">
          {ticket.title}
        </h2>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <SeverityChip severity={ticket.severity} />
          <StatusChip status={ticket.status} />
          <span className="rounded-full border border-line bg-surface-2 px-2.5 py-1 text-xs text-ink-muted">
            {qaTicketSourceLabels[ticket.source]} ·{" "}
            {qaTicketKindLabels[ticket.kind]}
          </span>
          <span className="ml-auto flex items-center gap-1.5 text-xs text-ink-muted">
            <Clock3 className="h-3.5 w-3.5" aria-hidden="true" />
            {idleLabel(ticket.idleMinutes)} depuis la dernière activité
          </span>
        </div>
        {overdue && (
          <p
            role="status"
            className="mt-4 flex items-start gap-2 rounded-xl border border-state-down/30 bg-state-down/[0.07] px-3 py-2.5 text-xs leading-5 text-state-down"
          >
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            Relance en retard : aucune activité depuis plus de 48 h sur ce
            dossier ouvert.
          </p>
        )}
      </header>

      {actionError && (
        <p role="alert" className="text-sm text-state-down">
          {actionError}
        </p>
      )}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <div className="space-y-5">
          <Section title="Demande du client" icon={MessageSquareText}>
            <p className="rounded-xl border-l-2 border-brand-glow/40 bg-page px-4 py-3 text-sm leading-6 whitespace-pre-wrap text-ink">
              {ticket.clientMessage}
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              <Line label="Signalé par" value={ticket.reporterName} />
              <Line label="E-mail" value={ticket.reporterEmail} />
              <Line label="Service concerné" value={ticket.monitorName} />
              <Line
                label="Ouvert le"
                value={formatDateTimeFr(ticket.createdAt)}
              />
              {ticket.resolvedAt ? (
                <Line
                  label="Résolu le"
                  value={formatDateTimeFr(ticket.resolvedAt)}
                />
              ) : null}
            </div>
            {ticket.pageUrl && (
              <a
                href={ticket.pageUrl}
                target="_blank"
                rel="noreferrer noopener"
                className="inline-flex items-center gap-2 text-xs text-brand-strong hover:text-brand-glow"
              >
                <Link2 className="h-3.5 w-3.5" aria-hidden="true" />
                {ticket.pageUrl}
              </a>
            )}
          </Section>

          {(ticket.steps || ticket.expected || ticket.actual) && (
            <Section title="Reproduction" icon={FileText}>
              <Line label="Étapes" value={ticket.steps} />
              <Line label="Résultat attendu" value={ticket.expected} />
              <Line label="Résultat observé" value={ticket.actual} />
            </Section>
          )}

          {ticket.evidence && (
            <Section title="Preuves saisies automatiquement" icon={Paperclip}>
              <div className="grid gap-3 sm:grid-cols-2">
                <Line label="Route" value={ticket.evidence.route} />
                <Line
                  label="Fenêtre"
                  value={
                    ticket.evidence.viewport
                      ? `${ticket.evidence.viewport.width} × ${ticket.evidence.viewport.height}`
                      : null
                  }
                />
                <Line label="Langue" value={ticket.evidence.locale} />
                <Line
                  label="Horodatage"
                  value={formatDateTimeFr(ticket.evidence.capturedAt)}
                />
              </div>
              <Line label="Navigateur" value={ticket.evidence.userAgent} />
              {ticket.evidence.javaScriptErrors.length > 0 && (
                <div>
                  <p className="text-[11px] uppercase tracking-[0.14em] text-ink-muted">
                    Erreurs JavaScript
                  </p>
                  <ul className="mt-2 space-y-1.5">
                    {ticket.evidence.javaScriptErrors.map(error => (
                      <li
                        key={`${error.at}-${error.message}`}
                        className="rounded-lg border border-line bg-page px-3 py-2 text-xs leading-5 text-ink-soft"
                      >
                        <span className="font-mono text-state-down">
                          {error.message}
                        </span>
                        <span className="mt-1 block text-ink-muted">
                          {error.source} · {formatDateTimeFr(error.at)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {ticket.evidence.failedRequests.length > 0 && (
                <div>
                  <p className="text-[11px] uppercase tracking-[0.14em] text-ink-muted">
                    Requêtes API en échec
                  </p>
                  <ul className="mt-2 space-y-1.5">
                    {ticket.evidence.failedRequests.map(request => (
                      <li
                        key={`${request.at}-${request.path}`}
                        className="rounded-lg border border-line bg-page px-3 py-2 font-mono text-xs text-ink-soft"
                      >
                        {request.path} ·{" "}
                        <span className="text-state-warn">
                          {request.status ?? request.code ?? "réseau"}
                        </span>
                        <span className="ml-1 text-ink-muted">
                          {request.durationMs === null
                            ? ""
                            : `${request.durationMs} ms`}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </Section>
          )}

          <Section title="Chronologie" icon={Clock3}>
            {events.length === 0 ? (
              <p className="text-sm text-ink-muted">Aucun événement.</p>
            ) : (
              <ol className="space-y-3">
                {events.map(event => (
                  <li
                    key={event.id}
                    className="border-l border-line pl-4 text-sm"
                  >
                    <p className="flex flex-wrap items-center gap-2 text-[11px] text-ink-muted">
                      <span className="font-semibold text-ink-soft">
                        {qaTicketEventAuthorLabels[event.author]}
                      </span>
                      {event.visibility === "internal" && (
                        <span className="rounded-full border border-brand-glow/25 bg-brand-subtle px-2 py-0.5 text-brand-glow">
                          Interne
                        </span>
                      )}
                      {event.toStatus && (
                        <span className="rounded-full border border-line px-2 py-0.5">
                          {event.fromStatus
                            ? `${qaTicketStatusLabels[event.fromStatus]} → `
                            : ""}
                          {qaTicketStatusLabels[event.toStatus]}
                        </span>
                      )}
                      {formatDateTimeFr(event.createdAt)}
                    </p>
                    <p className="mt-1.5 leading-6 whitespace-pre-wrap text-ink-soft">
                      {event.body}
                    </p>
                  </li>
                ))}
              </ol>
            )}
          </Section>
        </div>

        <div className="space-y-5">
          <Section title="Traiter le ticket" icon={ShieldAlert}>
            <div>
              <p className="text-[11px] uppercase tracking-[0.14em] text-ink-muted">
                statut
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                {QA_STATUS_TRANSITIONS[ticket.status].map(next => (
                  <button
                    key={next}
                    disabled={busy}
                    onClick={() =>
                      void run(async () => {
                        await api.updateQaTicket(ticket.id, { status: next });
                        await load();
                        onQueueChanged();
                      })
                    }
                    className="rounded-full border border-brand-glow/25 bg-brand-subtle px-3 py-1.5 text-xs text-brand-strong hover:bg-brand-muted disabled:opacity-50"
                  >
                    Passer à « {qaTicketStatusLabels[next]} »
                  </button>
                ))}
                {QA_STATUS_TRANSITIONS[ticket.status].length === 0 && (
                  <p className="text-xs text-ink-muted">
                    Ce dossier est clos : plus aucune transition.
                  </p>
                )}
              </div>
            </div>
            <label className="block">
              <span className="mb-2 block text-[11px] uppercase tracking-[0.14em] text-ink-muted">
                sévérité
              </span>
              <select
                value={ticket.severity}
                disabled={busy}
                onChange={event =>
                  void run(async () => {
                    await api.updateQaTicket(ticket.id, {
                      severity: event.currentTarget.value as QaTicketSeverity,
                    });
                    await load();
                    onQueueChanged();
                  })
                }
                className="auth-input w-full text-sm"
              >
                {QA_TICKET_SEVERITIES.map(value => (
                  <option key={value} value={value}>
                    {value} · {qaTicketSeverityLabels[value]}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="mb-2 block text-[11px] uppercase tracking-[0.14em] text-ink-muted">
                nature
              </span>
              <select
                value={ticket.kind}
                disabled={busy}
                onChange={event =>
                  void run(async () => {
                    await api.updateQaTicket(ticket.id, {
                      kind: event.currentTarget.value as QaTicketKind,
                    });
                    await load();
                    onQueueChanged();
                  })
                }
                className="auth-input w-full text-sm"
              >
                {(Object.keys(qaTicketKindLabels) as QaTicketKind[]).map(
                  value => (
                    <option key={value} value={value}>
                      {qaTicketKindLabels[value]}
                    </option>
                  )
                )}
              </select>
            </label>
          </Section>

          {followUpLink && (
            <Section title="Lien de suivi du client" icon={Link2}>
              <p className="text-xs leading-5 text-ink-muted">
                Lecture seule, sans compte. Le client y voit l’avancement et
                peut répondre ; ses messages repassent le dossier « En cours ».
              </p>
              <div className="flex items-center gap-2">
                <input
                  readOnly
                  value={followUpLink}
                  onFocus={event => event.currentTarget.select()}
                  aria-label="Lien de suivi de ce ticket"
                  className="auth-input flex-1 font-mono text-xs"
                />
                <CopyButton value={followUpLink} label="Copier" />
              </div>
            </Section>
          )}

          <Section title="Répondre en français" icon={MessageSquareText}>
            <div className="flex flex-wrap gap-2">
              {(
                [
                  ["acknowledgement", "Accusé de réception"],
                  ["clarification", "Demande de précision"],
                  ["resolution", "Annonce de résolution"],
                ] as const
              ).map(([kind, label]) => (
                <button
                  key={kind}
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      const result = await api.qaTicketReply(ticket.id, kind);
                      setDraft(result.template);
                    })
                  }
                  className="rounded-full border border-line px-3 py-1.5 text-xs text-ink-soft hover:bg-surface-2 disabled:opacity-50"
                >
                  {label}
                </button>
              ))}
            </div>
            {draft && (
              <div className="space-y-2">
                <textarea
                  readOnly
                  rows={8}
                  value={draft.body}
                  aria-label="Brouillon de réponse au client"
                  className="auth-input w-full text-xs leading-5"
                />
                <div className="flex flex-wrap gap-2">
                  <CopyButton value={draft.body} label="Copier le brouillon" />
                  <button
                    disabled={busy}
                    onClick={() =>
                      void run(async () => {
                        await api.addQaTicketEvent(ticket.id, {
                          body: draft.body,
                          visibility: "public",
                        });
                        setDraft(null);
                        await load();
                        onQueueChanged();
                      })
                    }
                    className="inline-flex items-center gap-1.5 rounded-full bg-brand px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-strong disabled:opacity-50"
                  >
                    <Send className="h-3.5 w-3.5" aria-hidden="true" />
                    Publier au client
                  </button>
                </div>
              </div>
            )}
            <p className="text-[11px] leading-5 text-ink-muted">
              Le produit n’envoie pas d’e-mails : publier la réponse la rend
              visible sur le lien de suivi du client.
            </p>
          </Section>

          <Section title="Note" icon={FileText}>
            <textarea
              rows={4}
              value={note}
              maxLength={4000}
              onChange={event => setNote(event.currentTarget.value)}
              placeholder="Observation, hypothèse, lien vers un commit…"
              aria-label="Nouvelle note"
              className="auth-input w-full text-sm"
            />
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex gap-2">
                {(["internal", "public"] as const).map(value => (
                  <label
                    key={value}
                    className={`cursor-pointer rounded-lg border px-3 py-1.5 text-xs ${
                      noteVisibility === value
                        ? "border-cyan-300/30 bg-cyan-300/10 text-cyan-200"
                        : "border-white/10 text-slate-400 hover:bg-white/5"
                    }`}
                  >
                    <input
                      type="radio"
                      name="note-visibility"
                      value={value}
                      checked={noteVisibility === value}
                      onChange={() => setNoteVisibility(value)}
                      className="sr-only"
                    />
                    {value === "internal" ? "Interne" : "Visible du client"}
                  </label>
                ))}
              </div>
              <button
                disabled={busy || note.trim().length === 0}
                onClick={() =>
                  void run(async () => {
                    await api.addQaTicketEvent(ticket.id, {
                      body: note.trim(),
                      visibility: noteVisibility,
                    });
                    setNote("");
                    await load();
                    onQueueChanged();
                  })
                }
                className="inline-flex items-center gap-2 rounded-xl bg-cyan-300 px-4 py-2 text-sm font-semibold text-[#07111d] hover:bg-cyan-200 disabled:opacity-50"
              >
                Enregistrer
              </button>
            </div>
          </Section>

          <Section title="Rapport interne" icon={FileText}>
            <pre className="max-h-[480px] overflow-auto rounded-xl border border-white/5 bg-[#0b1220] p-4 font-mono text-[11px] leading-5 whitespace-pre-wrap text-slate-300">
              {internalReport}
            </pre>
          </Section>
        </div>
      </div>
    </div>
  );
}
