import {
  Check,
  CheckCircle2,
  CircleDashed,
  Clock3,
  Loader2,
  MessageSquareText,
  Send,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useRoute } from "wouter";
import { useRouteSeo } from "@/lib/seo";
import {
  ApiError,
  api,
  errorMessage,
  type QaPublicTicketResponse,
} from "@/lib/api";
import { Logo } from "@/components/uptime/Logo";
import { Skeleton } from "@/components/ui/skeleton";
import { useAutoRefresh } from "@/hooks/useAutoRefresh";
import {
  qaReference,
  qaTicketKindLabels,
  qaTicketStatusLabels,
  type QaTicketStatus,
} from "@shared/contracts";
import {
  SeverityChip,
  StatusChip,
  formatDateTimeFr,
} from "@/components/uptime/qa/QaChips";

/**
 * The four milestones a reporter can make sense of, mapped onto the operator
 * statuses. Two real statuses share a step because the difference between them
 * is ours to manage, not something the reporter needs to decode.
 */
const STEPS: { label: string; statuses: QaTicketStatus[] }[] = [
  { label: "Reçu", statuses: ["new"] },
  { label: "Examiné", statuses: ["triaged"] },
  { label: "En traitement", statuses: ["in_progress", "waiting_client"] },
  { label: "Résolu", statuses: ["resolved", "closed"] },
];

function stepIndex(status: QaTicketStatus): number {
  return STEPS.findIndex(step => (step.statuses as string[]).includes(status));
}

function Field({ label, value }: { label: string; value: string | null }) {
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

function ProgressRail({ status }: { status: QaTicketStatus }) {
  const current = stepIndex(status);
  return (
    <ol className="mt-6 flex flex-wrap gap-x-4 gap-y-3">
      {STEPS.map((step, index) => {
        const reached = index <= current;
        const isCurrent = index === current;
        return (
          <li
            key={step.label}
            className="flex items-center gap-2 text-xs"
            aria-current={isCurrent ? "step" : undefined}
          >
            {isCurrent ? (
              <CircleDashed
                className="h-4 w-4 animate-spin text-brand motion-reduce:animate-none"
                aria-hidden="true"
              />
            ) : reached ? (
              <CheckCircle2
                className="h-4 w-4 text-state-up"
                aria-hidden="true"
              />
            ) : (
              <span
                className="h-2 w-2 rounded-full border border-line bg-surface-2"
                aria-hidden="true"
              />
            )}
            <span
              className={
                isCurrent
                  ? "font-semibold text-brand"
                  : reached
                    ? "text-ink-soft"
                    : "text-ink-muted"
              }
            >
              {step.label}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/**
 * Read-only follow-up for a reporter, reached through the tokenised link handed
 * out at submission. It shows exactly what the operator's queue shows the
 * client: their own words, the public part of the exchange, and the status —
 * never internal notes, never another customer's data.
 */
export default function SupportTicket() {
  const [, params] = useRoute("/support/:token");
  const token = params?.token ?? "";
  useRouteSeo({
    title: "Suivi de votre signalement",
    description: "État d'avancement et échanges sur un ticket de support.",
    path: `/support/${token}`,
    noindex: true,
  });
  const [data, setData] = useState<QaPublicTicketResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [invalidLink, setInvalidLink] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);

  const load = useCallback(async () => {
    if (!token) return;
    try {
      setData(await api.publicTicket(token));
      setInvalidLink(false);
      setError("");
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 404) {
        setInvalidLink(true);
        return;
      }
      setError(errorMessage(cause, "Chargement impossible"));
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);
  useAutoRefresh(() => load(), 60_000, data !== null);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setSending(true);
    setError("");
    try {
      setData(await api.publicTicketMessage(token, message.trim()));
      setMessage("");
      setSent(true);
    } catch (cause) {
      setError(errorMessage(cause, "Envoi impossible"));
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="min-h-screen bg-page font-sans text-ink">
      <header className="sticky top-0 z-20 border-b border-line bg-surface/85 backdrop-blur-md">
        <div className="mx-auto flex max-w-3xl flex-wrap items-center justify-between gap-3 px-5 py-4">
          <div className="flex items-center gap-2.5">
            <Logo className="h-8 w-8" />
            <span className="font-display text-lg font-semibold tracking-tight">
              Suivi de signalement
            </span>
          </div>
          <span
            role="status"
            className="flex items-center gap-2 text-xs text-ink-muted"
          >
            <span className="relative flex h-2 w-2">
              <span className="live-ping absolute inset-0 rounded-full bg-state-up" />
              <span className="relative h-2 w-2 rounded-full bg-state-up" />
            </span>
            Rechargé automatiquement
          </span>
        </div>
      </header>

      <main className="mx-auto max-w-3xl space-y-5 px-5 py-8">
        {loading ? (
          <>
            <Skeleton className="h-36 rounded-2xl" />
            <Skeleton className="h-56 rounded-2xl" />
          </>
        ) : invalidLink ? (
          <div className="rounded-2xl border border-line bg-surface p-8 text-center shadow-sm shadow-brand/5">
            <h1 className="font-display text-xl font-semibold">
              Lien de suivi invalide
            </h1>
            <p className="mt-2 text-sm leading-6 text-ink-soft">
              Ce lien ne correspond à aucun dossier, ou le dossier a été fermé
              et son lien révoqué. Repartez du formulaire « Signaler un problème
              » sur la page où vous avez constaté le souci.
            </p>
          </div>
        ) : !data ? (
          <div className="rounded-2xl border border-state-down/25 bg-surface p-8 text-center shadow-sm shadow-brand/5">
            <h1 className="font-display text-lg font-semibold">
              Avancement indisponible
            </h1>
            <p className="mt-2 text-sm text-ink-soft">{error}</p>
            <button
              onClick={() => void load()}
              className="mt-5 rounded-xl bg-brand px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-strong"
            >
              Réessayer
            </button>
          </div>
        ) : (
          <>
            <section
              className="animate-rise relative overflow-hidden rounded-2xl border border-line bg-surface p-6 shadow-sm shadow-brand/5"
              style={{ animationDelay: "40ms" }}
            >
              <span
                aria-hidden="true"
                className="animate-sheen pointer-events-none absolute inset-y-0 -left-1/3 w-1/3 bg-gradient-to-r from-transparent via-brand/10 to-transparent"
              />
              <p className="font-mono text-xs text-brand">
                {qaReference(data.ticket.id)}
              </p>
              <h1 className="font-display mt-2 text-xl font-semibold">
                {data.ticket.title}
              </h1>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <StatusChip status={data.ticket.status} />
                <SeverityChip severity={data.ticket.severity} />
                <span className="rounded-full border border-line bg-surface-2 px-2.5 py-1 text-xs text-ink-soft">
                  {qaTicketKindLabels[data.ticket.kind]}
                </span>
              </div>
              <ProgressRail status={data.ticket.status} />
              <p className="mt-4 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-muted">
                <Clock3 className="h-3.5 w-3.5" aria-hidden="true" />
                Déclaré le {formatDateTimeFr(data.ticket.createdAt)} · dernière
                activité {formatDateTimeFr(data.ticket.updatedAt)}
                {data.ticket.resolvedAt
                  ? ` · résolu le ${formatDateTimeFr(data.ticket.resolvedAt)}`
                  : ""}
              </p>
            </section>

            <section
              className="animate-rise rounded-2xl border border-line bg-surface p-6 shadow-sm shadow-brand/5"
              style={{ animationDelay: "120ms" }}
            >
              <h2 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-ink-muted">
                <MessageSquareText
                  className="h-3.5 w-3.5 text-brand"
                  aria-hidden="true"
                />
                Votre signalement
              </h2>
              <p className="mt-4 rounded-xl border-l-2 border-brand/40 bg-page px-4 py-3 text-sm leading-6 whitespace-pre-wrap text-ink">
                {data.ticket.clientMessage}
              </p>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <Field label="Étapes indiquées" value={data.ticket.steps} />
                <Field label="Résultat attendu" value={data.ticket.expected} />
                <Field label="Résultat observé" value={data.ticket.actual} />
                <Field
                  label="Service concerné"
                  value={data.ticket.monitorName}
                />
              </div>
              {data.ticket.pageUrl && (
                <a
                  href={data.ticket.pageUrl}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="mt-4 inline-block text-xs text-brand hover:text-brand-strong hover:underline"
                >
                  {data.ticket.pageUrl}
                </a>
              )}
            </section>

            <section
              className="animate-rise rounded-2xl border border-line bg-surface p-6 shadow-sm shadow-brand/5"
              style={{ animationDelay: "200ms" }}
            >
              <h2 className="font-display text-sm font-semibold">
                Échanges avec l’équipe qualité
              </h2>
              {data.events.length === 0 ? (
                <p className="mt-4 text-sm leading-6 text-ink-muted">
                  Personne n’a encore répondu. Chaque étape de la prise en
                  charge apparaîtra ici — l’équipe lit les signalements dans
                  l’ordre d’importance et revient vers vous avec une réponse
                  concrète.
                </p>
              ) : (
                <ol className="mt-4 space-y-3">
                  {data.events.map(event => (
                    <li key={event.id} className="border-l border-line pl-4">
                      <p className="flex flex-wrap items-center gap-2 text-[11px] text-ink-muted">
                        <span className="font-semibold text-ink">
                          {event.author === "client"
                            ? "Vous"
                            : event.author === "support"
                              ? "Équipe qualité"
                              : "Système"}
                        </span>
                        {event.toStatus && (
                          <span className="rounded-full border border-line bg-surface-2 px-2 py-0.5">
                            {event.fromStatus
                              ? `${qaTicketStatusLabels[event.fromStatus]} → `
                              : ""}
                            {qaTicketStatusLabels[event.toStatus]}
                          </span>
                        )}
                        {formatDateTimeFr(event.createdAt)}
                      </p>
                      <p className="mt-1.5 text-sm leading-6 whitespace-pre-wrap text-ink-soft">
                        {event.body}
                      </p>
                    </li>
                  ))}
                </ol>
              )}
            </section>

            {data.ticket.status === "closed" ? (
              <p className="animate-rise rounded-2xl border border-line bg-surface px-5 py-4 text-sm leading-6 text-ink-soft shadow-sm shadow-brand/5">
                Ce dossier est clos. Si le problème revient, signalez-le à
                nouveau depuis la page concernée : le nouveau lien de suivi
                reprendra l’historique de cette page dans son énoncé.
              </p>
            ) : (
              <section
                className="animate-rise rounded-2xl border border-line bg-surface p-6 shadow-sm shadow-brand/5"
                style={{ animationDelay: "280ms" }}
              >
                <h2 className="font-display text-sm font-semibold">
                  Ajouter une information
                </h2>
                <p className="mt-2 text-xs leading-5 text-ink-muted">
                  Précisions, captures d’écran décrivant le souci, moments où il
                  se reproduit : tout complément accélère le diagnostic. Envoyer
                  un message remet le dossier en cours de traitement.
                </p>
                <form onSubmit={onSubmit} className="mt-4 space-y-3">
                  <textarea
                    required
                    minLength={1}
                    maxLength={4000}
                    rows={4}
                    value={message}
                    onChange={event => setMessage(event.currentTarget.value)}
                    placeholder="Ex. le souci apparaît seulement le matin, après un rafraîchissement."
                    aria-label="Complément d’information"
                    className="field-input w-full text-sm"
                  />
                  {error && (
                    <p role="alert" className="text-sm text-state-down">
                      {error}
                    </p>
                  )}
                  {sent && !error && (
                    <p
                      role="status"
                      className="flex items-center gap-2 text-sm text-state-up"
                    >
                      <Check className="h-4 w-4" aria-hidden="true" />
                      Message ajouté à votre dossier.
                    </p>
                  )}
                  <div className="flex justify-end">
                    <button
                      type="submit"
                      disabled={sending || message.trim().length === 0}
                      className="inline-flex items-center gap-2 rounded-xl bg-brand px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-strong disabled:opacity-60"
                    >
                      {sending ? (
                        <Loader2
                          className="h-4 w-4 animate-spin"
                          aria-hidden="true"
                        />
                      ) : (
                        <Send className="h-4 w-4" aria-hidden="true" />
                      )}
                      Envoyer
                    </button>
                  </div>
                </form>
              </section>
            )}
          </>
        )}
      </main>
    </div>
  );
}
