import {
  Activity,
  AlertTriangle,
  BellRing,
  ClipboardList,
  Loader2,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useLocation } from "wouter";
import { useRouteSeo } from "@/lib/seo";
import {
  api,
  errorMessage,
  UnauthorizedError,
  type QaOverviewResponse,
  type QaTicket,
  type User,
} from "@/lib/api";
import {
  QA_TICKET_SOURCES,
  QA_TICKET_STATUSES,
  qaReference,
  qaTicketKindLabels,
  qaTicketSourceLabels,
  qaTicketStatusLabels,
  type QaRunStatus,
  type QaTicketSource,
  type QaTicketStatus,
  type QaTotals,
} from "@shared/contracts";
import { AppShell } from "@/components/uptime/AppShell";
import { ErrorState } from "@/components/uptime/PageState";
import { Skeleton } from "@/components/ui/skeleton";
import { useAutoRefresh } from "@/hooks/useAutoRefresh";
import { QaTicketDetail } from "@/components/uptime/qa/QaTicketDetail";
import {
  SeverityChip,
  StatusChip,
  formatDateTimeFr,
  idleLabel,
  isOverdue,
} from "@/components/uptime/qa/QaChips";

const runStatusLabels: Record<QaRunStatus, string> = {
  ok: "Sain",
  attention: "À surveiller",
  failed: "Échoué",
};

const runStatusStyles: Record<QaRunStatus, string> = {
  ok: "border-state-up/30 bg-state-up/10 text-state-up",
  attention: "border-state-warn/30 bg-state-warn/10 text-state-warn",
  failed: "border-state-down/30 bg-state-down/10 text-state-down",
};

function StatCard({
  label,
  value,
  hint,
  alarm = false,
}: {
  label: string;
  value: number;
  hint: string;
  alarm?: boolean;
}) {
  return (
    <div
      className={`rounded-2xl border p-4 shadow-soft ${alarm && value > 0 ? "border-state-down/30 bg-state-down/[0.07]" : "border-line bg-surface"}`}
    >
      <p className="text-[11px] uppercase tracking-[0.14em] text-ink-muted">
        {label}
      </p>
      <p
        className={`mt-2 text-2xl font-semibold ${alarm && value > 0 ? "text-state-down" : "text-ink"}`}
      >
        {value}
      </p>
      <p className="mt-1 text-[11px] leading-4 text-ink-muted">{hint}</p>
    </div>
  );
}

function Panel({
  title,
  icon: Icon,
  action,
  children,
}: {
  title: string;
  icon: typeof Activity;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-line bg-surface p-5 shadow-soft">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-ink">
          <Icon className="h-4 w-4 text-brand-glow" aria-hidden="true" />
          {title}
        </h2>
        {action}
      </div>
      <div className="mt-4">{children}</div>
    </section>
  );
}

export default function QaQueue() {
  useRouteSeo({
    title: "File de signalements",
    description: "Traitement interne des signalements qualité et support.",
    path: "/qa",
    noindex: true,
  });
  const [, navigate] = useLocation();
  const [user, setUser] = useState<User | null>(null);
  const [overview, setOverview] = useState<QaOverviewResponse | null>(null);
  const [tickets, setTickets] = useState<QaTicket[]>([]);
  const [totals, setTotals] = useState<QaTotals | null>(null);
  const [statusFilter, setStatusFilter] = useState<"" | QaTicketStatus>("");
  const [sourceFilter, setSourceFilter] = useState<"" | QaTicketSource>("");
  const [selected, setSelected] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [panelError, setPanelError] = useState("");
  const [busyPanel, setBusyPanel] = useState<"self" | "digest" | null>(null);

  const load = useCallback(
    async (options: { initial?: boolean } = {}) => {
      if (options.initial) setLoading(true);
      try {
        const auth = await api.me();
        setUser(auth.user);
        const [nextOverview, list] = await Promise.all([
          api.qaOverview(),
          api.qaTickets({
            status: statusFilter || undefined,
            source: sourceFilter || undefined,
          }),
        ]);
        setOverview(nextOverview);
        setTickets(list.tickets);
        setTotals(list.totals);
        setError("");
      } catch (cause) {
        if (cause instanceof UnauthorizedError) {
          navigate("/login");
          return;
        }
        setError(errorMessage(cause, "File de qualité indisponible"));
      } finally {
        setLoading(false);
      }
    },
    [navigate, sourceFilter, statusFilter]
  );

  useEffect(() => {
    void load({ initial: true });
  }, [load]);

  // The queue is a working screen: it must show a colleague's new ticket
  // without a manual reload, but pause while a ticket is open for triage.
  useAutoRefresh(() => load(), 60_000, !loading && selected === null);

  async function runPanel(
    kind: "self" | "digest",
    action: () => Promise<unknown>
  ) {
    setBusyPanel(kind);
    setPanelError("");
    try {
      await action();
      await load();
    } catch (cause) {
      setPanelError(errorMessage(cause, "Passe impossible"));
    } finally {
      setBusyPanel(null);
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-page p-8">
        <Skeleton className="mx-auto h-64 max-w-[1440px] rounded-2xl" />
      </div>
    );
  }

  if (!user) {
    return (
      <ErrorState
        title="Espace qualité indisponible"
        message={error || "Session expirée, reconnectez-vous."}
        onRetry={() => void load({ initial: true })}
      />
    );
  }

  return (
    <AppShell user={user}>
      <div className="space-y-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-sm text-brand-glow">
              <ShieldCheck className="h-4 w-4" aria-hidden="true" />
              Qualité & support
            </div>
            <h1 className="mt-2 text-2xl font-semibold tracking-tight text-ink sm:text-3xl">
              {selected === null ? "File de traitement" : "Dossier en cours"}
            </h1>
            <p className="mt-1 text-sm text-ink-muted">
              Signalements clients, anomalies détectées par les auto-tests et
              suivi jusqu’à résolution.
            </p>
          </div>
          {selected === null && (
            <button
              onClick={() => void load()}
              className="inline-flex items-center gap-2 rounded-full border border-line px-4 py-2.5 text-sm font-medium text-ink-soft hover:bg-surface-2"
            >
              <RefreshCw className="h-4 w-4" aria-hidden="true" />
              Actualiser
            </button>
          )}
        </div>

        {error && !overview && (
          <p role="alert" className="text-sm text-state-down">
            {error}
          </p>
        )}

        {selected !== null ? (
          <QaTicketDetail
            ticketId={selected}
            onBack={() => setSelected(null)}
            onQueueChanged={() => void load()}
          />
        ) : (
          <>
            {totals && (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
                <StatCard
                  label="Ouverts"
                  value={totals.open}
                  hint="Tous les dossiers encore à traiter"
                />
                <StatCard
                  label="Nouveaux"
                  value={totals.fresh}
                  hint="Personne ne les a encore triés"
                />
                <StatCard
                  label="Attente client"
                  value={totals.waitingClient}
                  hint="On attend une précision"
                />
                <StatCard
                  label="Auto-détectés"
                  value={totals.autoOpen}
                  hint="Ouverts par les auto-tests"
                />
                <StatCard
                  label="Résolus / 7 j"
                  value={totals.resolvedThisWeek}
                  hint="Dossiers confirmés cette semaine"
                />
                <StatCard
                  label="Relances en retard"
                  value={totals.overdue}
                  hint="Ouverts et sans activité depuis 48 h"
                  alarm
                />
              </div>
            )}

            {panelError && (
              <p role="alert" className="text-sm text-state-down">
                {panelError}
              </p>
            )}

            <div className="grid gap-5 lg:grid-cols-2">
              <Panel
                title="Auto-tests fonctionnels"
                icon={Activity}
                action={
                  <button
                    onClick={() =>
                      void runPanel("self", () => api.runQaSelfTests())
                    }
                    disabled={busyPanel !== null}
                    className="inline-flex items-center gap-2 rounded-full border border-line px-3 py-1.5 text-xs text-ink-soft hover:bg-surface-2 disabled:opacity-50"
                  >
                    {busyPanel === "self" ? (
                      <Loader2
                        className="h-3.5 w-3.5 animate-spin"
                        aria-hidden="true"
                      />
                    ) : (
                      <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
                    )}
                    Lancer une passe
                  </button>
                }
              >
                {!overview?.lastSelfTest ? (
                  <p className="text-sm text-ink-muted">
                    Aucune passe enregistrée. La première a lieu au prochain
                    tick du planificateur.
                  </p>
                ) : (
                  <div className="space-y-3">
                    <p className="flex flex-wrap items-center gap-2 text-xs text-ink-muted">
                      <span
                        className={`rounded-full border px-2.5 py-1 font-medium ${runStatusStyles[overview.lastSelfTest.status]}`}
                      >
                        {runStatusLabels[overview.lastSelfTest.status]}
                      </span>
                      Passe {overview.lastSelfTest.periodKey} ·{" "}
                      {overview.lastSelfTest.results.length} invariant(s)
                    </p>
                    <ul className="max-h-[320px] space-y-2 overflow-auto">
                      {overview.lastSelfTest.results.map(result => (
                        <li
                          key={result.id}
                          className="rounded-xl border border-line bg-page px-3 py-2.5"
                        >
                          <p className="flex items-center gap-2 text-xs font-medium text-ink">
                            <span
                              className={
                                result.ok ? "text-state-up" : "text-state-down"
                              }
                              aria-hidden="true"
                            >
                              {result.ok ? "✓" : "✗"}
                            </span>
                            {result.label}
                            {!result.ok && (
                              <span className="ml-auto text-state-down">
                                {result.severity}
                              </span>
                            )}
                          </p>
                          <p className="mt-1 text-[11px] leading-5 text-ink-muted">
                            Attendu : {result.expected}
                          </p>
                          <p className="text-[11px] leading-5 text-ink-muted">
                            Observé : {result.actual}
                          </p>
                          {result.ticketId !== null && (
                            <button
                              onClick={() => {
                                if (result.ticketId !== null)
                                  setSelected(result.ticketId);
                              }}
                              className="mt-1 text-[11px] font-semibold text-brand-strong hover:text-brand-glow"
                            >
                              Ouvrir le dossier {qaReference(result.ticketId)}
                            </button>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </Panel>

              <Panel
                title="Point quotidien"
                icon={ClipboardList}
                action={
                  <button
                    onClick={() =>
                      void runPanel("digest", () => api.runQaDigest())
                    }
                    disabled={busyPanel !== null}
                    className="inline-flex items-center gap-2 rounded-full border border-line px-3 py-1.5 text-xs text-ink-soft hover:bg-surface-2 disabled:opacity-50"
                  >
                    {busyPanel === "digest" ? (
                      <Loader2
                        className="h-3.5 w-3.5 animate-spin"
                        aria-hidden="true"
                      />
                    ) : (
                      <BellRing className="h-3.5 w-3.5" aria-hidden="true" />
                    )}
                    Régénérer
                  </button>
                }
              >
                {!overview?.digest ? (
                  <p className="text-sm text-ink-muted">
                    Aucun point du jour. Il est produit automatiquement une fois
                    par jour et inclut le test fonctionnel de la page publique.
                  </p>
                ) : (
                  <div className="space-y-3">
                    <p className="flex flex-wrap items-center gap-2 text-xs text-ink-muted">
                      <span
                        className={`rounded-full border px-2.5 py-1 font-medium ${runStatusStyles[overview.digest.status]}`}
                      >
                        {runStatusLabels[overview.digest.status]}
                      </span>
                      {overview.digest.date} · {overview.digest.newCount}{" "}
                      nouveau (x) · {overview.digest.resolvedCount} résolu (x) ·{" "}
                      {overview.digest.autoCount} auto
                    </p>
                    <pre className="max-h-[320px] overflow-auto rounded-xl border border-line bg-page p-4 font-mono text-[11px] leading-5 whitespace-pre-wrap text-ink-soft">
                      {overview.digest.markdown}
                    </pre>
                  </div>
                )}
              </Panel>
            </div>

            <section className="rounded-2xl border border-line bg-surface p-5 shadow-soft">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 className="text-sm font-semibold text-ink">
                  Tickets ({tickets.length})
                </h2>
                <div className="flex flex-wrap gap-2">
                  <label className="flex items-center gap-2 text-xs text-ink-muted">
                    Statut
                    <select
                      value={statusFilter}
                      onChange={event =>
                        setStatusFilter(
                          event.currentTarget.value as "" | QaTicketStatus
                        )
                      }
                      className="auth-input py-1.5 text-xs"
                    >
                      <option value="">Tous</option>
                      {QA_TICKET_STATUSES.map(value => (
                        <option key={value} value={value}>
                          {qaTicketStatusLabels[value]}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="flex items-center gap-2 text-xs text-ink-muted">
                    Origine
                    <select
                      value={sourceFilter}
                      onChange={event =>
                        setSourceFilter(
                          event.currentTarget.value as "" | QaTicketSource
                        )
                      }
                      className="auth-input py-1.5 text-xs"
                    >
                      <option value="">Toutes</option>
                      {QA_TICKET_SOURCES.map(value => (
                        <option key={value} value={value}>
                          {qaTicketSourceLabels[value]}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              </div>

              {tickets.length === 0 ? (
                <p className="mt-6 rounded-xl border border-dashed border-line px-4 py-8 text-center text-sm text-ink-muted">
                  Aucun ticket pour ce filtre. Les signalements clients et les
                  anomalies des auto-tests arrivent ici.
                </p>
              ) : (
                <ul className="mt-4 space-y-2">
                  {tickets.map(ticket => {
                    const overdue = isOverdue(
                      ticket.status,
                      ticket.idleMinutes
                    );
                    return (
                      <li key={ticket.id}>
                        <button
                          onClick={() => setSelected(ticket.id)}
                          className={`flex w-full flex-wrap items-center gap-3 rounded-xl border px-4 py-3 text-left transition ${overdue ? "border-state-down/30 bg-state-down/[0.06] hover:bg-state-down/[0.10]" : "border-line bg-page hover:bg-surface-2"}`}
                        >
                          <span className="font-mono text-xs text-brand-glow">
                            {qaReference(ticket.id)}
                          </span>
                          <span className="min-w-[180px] flex-1 truncate text-sm font-medium text-ink">
                            {ticket.title}
                          </span>
                          <SeverityChip severity={ticket.severity} />
                          <StatusChip status={ticket.status} />
                          <span className="text-[11px] text-ink-muted">
                            {qaTicketKindLabels[ticket.kind]} ·{" "}
                            {qaTicketSourceLabels[ticket.source]}
                          </span>
                          <span
                            className={`ml-auto flex items-center gap-1.5 text-[11px] ${overdue ? "text-state-down" : "text-ink-muted"}`}
                          >
                            {overdue && (
                              <AlertTriangle
                                className="h-3.5 w-3.5"
                                aria-hidden="true"
                              />
                            )}
                            {idleLabel(ticket.idleMinutes)} ·{" "}
                            {formatDateTimeFr(ticket.createdAt)}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          </>
        )}
      </div>
    </AppShell>
  );
}
