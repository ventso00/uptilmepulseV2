import {
  Activity,
  ArrowUpRight,
  Check,
  Clock3,
  Edit3,
  Globe2,
  Loader2,
  Pause,
  Play,
  Plus,
  RefreshCw,
  ShieldAlert,
  Trash2,
  Zap,
} from "lucide-react";
import { Link, useLocation } from "wouter";
import { toast } from "sonner";
import { useCallback, useEffect, useState } from "react";
import {
  api,
  apiRequestUntyped,
  errorMessage,
  formatRelativeDate,
  UnauthorizedError,
  type DashboardData,
  type Monitor,
  type PlanPublic,
  type User,
} from "@/lib/api";
import { AppShell } from "@/components/uptime/AppShell";
import { StatusBadge } from "@/components/uptime/StatusBadge";
import { ErrorState } from "@/components/uptime/PageState";
import { Reveal } from "@/components/uptime/Reveal";
import { Skeleton } from "@/components/ui/skeleton";
import { useAutoRefresh } from "@/hooks/useAutoRefresh";
import { Modal } from "@/components/uptime/Modal";
import { RowMenu } from "@/components/uptime/RowMenu";
import { ConfirmDialog } from "@/components/uptime/ConfirmDialog";
import {
  FREE_PLAN,
  INCIDENT_RULES,
  monitorKeywordModeLabels,
  monitorKeywordModeValues,
  type MonitorKeywordMode,
} from "@shared/contracts";
import { useMyPlan } from "@/hooks/useMyPlan";

export default function Dashboard() {
  const [, navigate] = useLocation();
  const [user, setUser] = useState<User | null>(null);
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [modal, setModal] = useState(false);
  const [editingMonitor, setEditingMonitor] = useState<Monitor | null>(null);
  const [actionError, setActionError] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const { plan, refresh: refreshPlan } = useMyPlan();

  const load = useCallback(
    async (options: { initial?: boolean } = {}) => {
      if (options.initial) setLoading(true);
      else setRefreshing(true);
      try {
        const auth = await api.me();
        setUser(auth.user);
        setData(await api.dashboard());
        setError("");
      } catch (err) {
        if (err instanceof UnauthorizedError) {
          navigate("/login");
          return;
        }
        setError(errorMessage(err, "Impossible de charger le dashboard"));
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [navigate]
  );

  useEffect(() => {
    void load({ initial: true });
  }, [load]);

  useAutoRefresh(() => load(), 60_000, !loading && !modal);

  if (loading) return <DashboardSkeleton />;
  if (!user || !data)
    return (
      <ErrorState
        title="Dashboard indisponible"
        message={
          error || "Les données du dashboard n’ont pas pu être chargées."
        }
        onRetry={() => void load({ initial: true })}
      />
    );

  return (
    <AppShell user={user}>
      <div className="space-y-8">
        <div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
          <div>
            <div className="flex items-center gap-2 text-sm text-brand-glow">
              <span
                className="h-1.5 w-1.5 rounded-full bg-brand-glow"
                aria-hidden="true"
              />
              Vue d’ensemble
            </div>
            <h1 className="mt-3 text-3xl font-semibold tracking-tight text-ink sm:text-4xl">
              Bonjour, voici votre signal.
            </h1>
            <p className="mt-2 text-sm text-ink-muted">
              Les services qui comptent, résumés en un regard.
            </p>
          </div>
          <div className="flex gap-3">
            <button
              onClick={() => void load()}
              disabled={refreshing}
              className="inline-flex items-center justify-center gap-2 rounded-full border border-line px-4 py-2.5 text-sm font-medium text-ink-soft hover:bg-surface-2 disabled:opacity-60"
            >
              {refreshing ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <RefreshCw className="h-4 w-4" aria-hidden="true" />
              )}
              Actualiser
            </button>
            <button
              onClick={() => {
                setEditingMonitor(null);
                setActionError("");
                setModal(true);
              }}
              className="inline-flex items-center justify-center gap-2 rounded-full bg-brand px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-strong"
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
              Ajouter un monitor
            </button>
          </div>
        </div>
        {actionError && (
          <p
            className="rounded-xl border border-state-down/30 bg-state-down/10 px-4 py-3 text-sm text-state-down"
            role="alert"
          >
            {actionError}
          </p>
        )}
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Reveal delay={0}>
            <Kpi
              label="Monitors actifs"
              value={`${data.summary.upMonitors}/${data.summary.totalMonitors}`}
              detail={
                data.summary.totalMonitors === 0
                  ? "Commencez par ajouter une URL"
                  : `${data.summary.downMonitors} incident${data.summary.downMonitors > 1 ? "s" : ""}`
              }
              icon={<Globe2 className="h-5 w-5" />}
              accent="cyan"
            />
          </Reveal>
          <Reveal delay={80}>
            <Kpi
              label="Uptime global · 30 jours"
              value={
                data.summary.uptimePercent === null
                  ? "—"
                  : `${data.summary.uptimePercent.toFixed(2)}%`
              }
              detail="Checks enregistrés"
              icon={<Zap className="h-5 w-5" />}
              accent="emerald"
            />
          </Reveal>
          <Reveal delay={160}>
            <Kpi
              label="Incidents actifs"
              value={String(data.summary.activeIncidents)}
              detail={
                data.summary.activeIncidents === 0
                  ? "Tout est stable"
                  : "Action recommandée"
              }
              icon={<ShieldAlert className="h-5 w-5" />}
              accent={data.summary.activeIncidents ? "rose" : "amber"}
            />
          </Reveal>
          <Reveal delay={240}>
            <Kpi
              label="Réponse moyenne"
              value={
                data.summary.averageResponseTimeMs === null
                  ? "—"
                  : `${data.summary.averageResponseTimeMs} ms`
              }
              detail="Sur les 30 derniers jours"
              icon={<Clock3 className="h-5 w-5" />}
              accent="violet"
            />
          </Reveal>
        </div>
        <div className="grid gap-5 xl:grid-cols-[1fr_360px]">
          <Reveal delay={120}>
            <section className="overflow-hidden rounded-2xl border border-line bg-surface shadow-soft">
              <div className="flex items-center justify-between gap-4 border-b border-line px-5 py-5 sm:px-6">
                <div>
                  <h2 className="font-semibold text-ink">Vos monitors</h2>
                  <p className="mt-1 text-xs text-ink-muted">
                    État actuel · uptime calculé sur 30 jours
                  </p>
                </div>
                <span className="rounded-full bg-surface-2 px-2.5 py-1 text-xs text-ink-muted">
                  {plan
                    ? `${plan.usage.monitors} / ${plan.plan.maxMonitors}`
                    : `${data.monitors.length} / ${FREE_PLAN.maxMonitors}`}
                </span>
              </div>
              {data.monitors.length === 0 ? (
                <EmptyState
                  onCreate={() => {
                    setEditingMonitor(null);
                    setModal(true);
                  }}
                />
              ) : (
                <div className="divide-y divide-line">
                  <div className="hidden grid-cols-[1.55fr_0.8fr_0.55fr_0.7fr_0.9fr_36px] gap-4 px-6 py-3 text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-muted md:grid">
                    <span>Service</span>
                    <span>État</span>
                    <span>Code</span>
                    <span>Uptime</span>
                    <span>Réponse</span>
                    <span className="sr-only">Actions</span>
                  </div>
                  {data.monitors.map(monitor => (
                    <MonitorRow
                      key={monitor.id}
                      monitor={monitor}
                      onRefresh={load}
                      onEdit={target => {
                        setEditingMonitor(target);
                        setActionError("");
                        setModal(true);
                      }}
                      onError={setActionError}
                    />
                  ))}
                </div>
              )}
            </section>
          </Reveal>
          <Reveal delay={160}>
            <aside className="space-y-5">
              <div className="rounded-2xl border border-brand-glow/25 bg-gradient-to-br from-brand-subtle to-transparent p-5 shadow-soft">
                <div className="flex items-center justify-between">
                  <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand-subtle text-brand-glow">
                    <Activity className="h-4 w-4" aria-hidden="true" />
                  </div>
                  <span className="text-[10px] font-semibold uppercase tracking-[0.15em] text-brand-glow/70">
                    Signal pulse
                  </span>
                </div>
                <h3 className="mt-5 text-lg font-semibold text-ink">
                  Surveiller, pas deviner.
                </h3>
                <p className="mt-2 text-sm leading-6 text-ink-muted">
                  Chaque panne est confirmée par{" "}
                  {INCIDENT_RULES.failureThreshold} échecs consécutifs. Vous
                  recevez un signal fiable, pas une alerte isolée.
                </p>
                <Link
                  href="/settings"
                  className="mt-4 inline-flex items-center gap-1.5 text-xs font-semibold text-brand-strong hover:text-brand-glow"
                >
                  Configurer Telegram{" "}
                  <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
                </Link>
              </div>
              <div className="rounded-2xl border border-line bg-surface shadow-soft p-5">
                <div className="flex items-center justify-between">
                  <h3 className="font-semibold text-ink">Incidents actifs</h3>
                  <span className="text-xs text-ink-muted">30 jours</span>
                </div>
                {data.incidents.length === 0 ? (
                  <div className="mt-6 flex items-start gap-3">
                    <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-state-up/10 text-state-up">
                      <Check className="h-3.5 w-3.5" aria-hidden="true" />
                    </div>
                    <div>
                      <p className="text-sm text-ink-soft">
                        Aucun incident actif
                      </p>
                      <p className="mt-1 text-xs leading-5 text-ink-muted">
                        Vos services sont stables pour le moment.
                      </p>
                    </div>
                  </div>
                ) : (
                  <div className="mt-4 space-y-3">
                    {data.incidents.slice(0, 4).map(incident => (
                      <Link
                        key={incident.id}
                        href={`/monitors/${incident.monitorId}`}
                        className="block rounded-xl border border-state-down/30 bg-state-down/[0.04] p-3 hover:bg-state-down/[0.08]"
                      >
                        <div className="flex items-center justify-between gap-3">
                          <span className="truncate text-sm font-medium text-ink">
                            {incident.monitorName}
                          </span>
                          <span
                            className="h-2 w-2 shrink-0 rounded-full bg-state-down"
                            aria-label="Incident actif"
                          />
                        </div>
                        <p className="mt-1 truncate text-xs text-ink-muted">
                          {incident.reason || "Échec confirmé"}
                        </p>
                      </Link>
                    ))}
                  </div>
                )}
              </div>
            </aside>
          </Reveal>
        </div>
      </div>
      {modal && (
        <CreateMonitorModal
          monitor={editingMonitor}
          plan={plan?.plan ?? null}
          onClose={() => setModal(false)}
          onCreated={() => {
            setModal(false);
            void refreshPlan();
            toast.success(
              editingMonitor
                ? `« ${editingMonitor.name} » mis à jour.`
                : "Monitor créé — premier check en cours."
            );
            setEditingMonitor(null);
            void load();
          }}
        />
      )}
    </AppShell>
  );
}

function DashboardSkeleton() {
  return (
    <main aria-busy="true" className="min-h-screen bg-page px-4 py-10 sm:px-6">
      <div className="mx-auto max-w-6xl space-y-8">
        <div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
          <div className="space-y-3">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-9 w-72" />
          </div>
          <Skeleton className="h-10 w-40" />
        </div>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {[0, 1, 2, 3].map(i => (
            <Skeleton key={i} className="h-28" />
          ))}
        </div>
        <div className="grid gap-5 xl:grid-cols-[1fr_360px]">
          <Skeleton className="h-96" />
          <div className="space-y-5">
            <Skeleton className="h-44" />
            <Skeleton className="h-40" />
          </div>
        </div>
      </div>
    </main>
  );
}

function Kpi({
  label,
  value,
  detail,
  icon,
  accent,
}: {
  label: string;
  value: string;
  detail: string;
  icon: React.ReactNode;
  accent: "cyan" | "emerald" | "rose" | "amber" | "violet";
}) {
  const colors = {
    cyan: "text-brand-glow bg-brand-subtle",
    emerald: "text-state-up bg-state-up/10",
    rose: "text-state-down bg-state-down/10",
    amber: "text-state-warn bg-state-warn/10",
    violet: "text-ink-soft bg-surface-3",
  };
  return (
    <div className="rounded-2xl border border-line bg-surface shadow-soft p-5">
      <div className="flex items-start justify-between">
        <span className="text-xs text-ink-muted">{label}</span>
        <div className={`rounded-lg p-2 ${colors[accent]}`} aria-hidden="true">
          {icon}
        </div>
      </div>
      <div className="mt-5 text-2xl font-semibold tracking-tight text-ink">
        {value}
      </div>
      <div className="mt-1 text-xs text-ink-muted">{detail}</div>
    </div>
  );
}

function MonitorRow({
  monitor,
  onRefresh,
  onEdit,
  onError,
}: {
  monitor: Monitor;
  onRefresh: () => Promise<void>;
  onEdit: (monitor: Monitor) => void;
  onError: (message: string) => void;
}) {
  const [, navigate] = useLocation();
  const [pending, setPending] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  async function runNow() {
    setPending(true);
    try {
      const { check } = await api.runCheck(monitor.id);
      await onRefresh();
      if (!check) toast.info("Un check est déjà en cours.");
      else if (check.isUp)
        toast.success(
          `« ${monitor.name} » répond — ${check.statusCode ?? "OK"} en ${check.responseTimeMs ?? "—"} ms${check.ttfbMs !== null ? ` (TTFB ${check.ttfbMs} ms)` : ""}.`
        );
      else
        toast.error(`« ${monitor.name} » en échec (${check.classification}).`);
    } catch (error) {
      if (error instanceof UnauthorizedError) {
        navigate("/login");
        return;
      }
      onError(errorMessage(error, "Check impossible"));
    } finally {
      setPending(false);
    }
  }

  async function action(path: string, method: string, successMessage: string) {
    setPending(true);
    try {
      await apiRequestUntyped(path, { method });
      await onRefresh();
      toast.success(successMessage);
    } catch (error) {
      if (error instanceof UnauthorizedError) {
        navigate("/login");
        return;
      }
      onError(errorMessage(error, "Action impossible"));
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="relative grid gap-3 px-5 py-4 transition hover:bg-page sm:px-6 md:grid-cols-[1.55fr_0.8fr_0.55fr_0.7fr_0.9fr_36px] md:items-center">
      <button
        onClick={() => navigate(`/monitors/${monitor.id}`)}
        className="min-w-0 text-left"
      >
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-line bg-page text-ink-muted">
            <Globe2 className="h-4 w-4" aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-ink">
              {monitor.name}
            </p>
            <p className="mt-0.5 truncate font-mono text-[11px] text-ink-muted">
              {monitor.url}
            </p>
            <UptimeStrip checks={monitor.recentChecks} />
          </div>
        </div>
      </button>
      <div className="flex items-center justify-between md:block">
        <span className="mr-2 text-[10px] uppercase tracking-wider text-ink-muted md:hidden">
          État
        </span>
        <StatusBadge status={monitor.status} />
      </div>
      <div className="flex items-center justify-between text-sm md:block">
        <span className="mr-2 text-[10px] uppercase tracking-wider text-ink-muted md:hidden">
          Code
        </span>
        <span
          className={`font-mono text-xs ${monitor.latestCheck?.isUp ? "text-state-up" : "text-ink-muted"}`}
        >
          {monitor.latestCheck?.statusCode ?? "—"}
        </span>
      </div>
      <div className="flex items-center justify-between text-sm md:block">
        <span className="mr-2 text-[10px] uppercase tracking-wider text-ink-muted md:hidden">
          Uptime
        </span>
        <span className="text-ink-soft">
          {monitor.uptimePercent !== null ? (
            `${monitor.uptimePercent.toFixed(2)}%`
          ) : monitor.status === "UNKNOWN" && monitor.enabled ? (
            <span className="text-xs text-brand-glow/80">
              Premier check à{" "}
              {new Intl.DateTimeFormat("fr-FR", {
                hour: "2-digit",
                minute: "2-digit",
              }).format(new Date(monitor.nextCheckAt))}
            </span>
          ) : (
            "—"
          )}
        </span>
      </div>
      <div className="flex items-center justify-between text-sm md:block">
        <span className="mr-2 text-[10px] uppercase tracking-wider text-ink-muted md:hidden">
          Dernier check
        </span>
        <span className="text-ink-muted">
          {monitor.latestCheck?.responseTimeMs == null
            ? "—"
            : `${monitor.latestCheck.responseTimeMs} ms`}{" "}
          <span className="text-xs text-ink-muted">
            · {formatRelativeDate(monitor.lastCheckAt)}
          </span>
        </span>
      </div>
      <div className="absolute right-5 top-5 md:relative md:right-auto md:top-auto">
        <RowMenu
          label={`Actions pour ${monitor.name}`}
          actions={[
            {
              label: "Vérifier maintenant",
              icon: <Zap className="h-3.5 w-3.5" aria-hidden="true" />,
              disabled: pending || !monitor.enabled,
              onSelect: () => void runNow(),
            },
            {
              label: "Voir le détail",
              onSelect: () => navigate(`/monitors/${monitor.id}`),
            },
            {
              label: "Modifier",
              icon: <Edit3 className="h-3.5 w-3.5" aria-hidden="true" />,
              onSelect: () => onEdit(monitor),
            },
            {
              label: monitor.enabled ? "Mettre en pause" : "Reprendre",
              icon: monitor.enabled ? (
                <Pause className="h-3.5 w-3.5" aria-hidden="true" />
              ) : (
                <Play className="h-3.5 w-3.5" aria-hidden="true" />
              ),
              disabled: pending,
              onSelect: () =>
                void action(
                  `/api/monitors/${monitor.id}/${monitor.enabled ? "pause" : "resume"}`,
                  "POST",
                  monitor.enabled
                    ? `« ${monitor.name} » mis en pause.`
                    : `« ${monitor.name} » repris — les checks reprennent.`
                ),
            },
            {
              label: "Supprimer",
              icon: <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />,
              tone: "danger",
              onSelect: () => setConfirmDelete(true),
            },
          ]}
        />
      </div>
      {confirmDelete && (
        <ConfirmDialog
          title="Supprimer ce monitor ?"
          description={`« ${monitor.name} » et son historique seront supprimés définitivement. Cette action est irréversible.`}
          confirmLabel="Supprimer"
          onCancel={() => setConfirmDelete(false)}
          onConfirm={() => {
            setConfirmDelete(false);
            void action(
              `/api/monitors/${monitor.id}`,
              "DELETE",
              `« ${monitor.name} » supprimé.`
            );
          }}
        />
      )}
    </div>
  );
}

function UptimeStrip({ checks }: { checks: Monitor["recentChecks"] }) {
  if (checks.length === 0) return null;
  const formatter = new Intl.DateTimeFormat("fr-FR", {
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
  return (
    <div
      className="mt-2 flex max-w-full items-end gap-px overflow-hidden"
      aria-hidden="true"
    >
      {checks.map((check, index) => (
        <span
          key={index}
          title={`${formatter.format(new Date(check.checkedAt))} · ${
            check.isUp ? "en ligne" : "hors ligne"
          }${check.responseTimeMs !== null ? ` · ${check.responseTimeMs} ms` : ""}`}
          style={{ animationDelay: `${index * 16}ms` }}
          className={`uptime-bar h-5 w-1.5 rounded-[2px] ${
            check.isUp
              ? "bg-state-up/60 hover:bg-state-up"
              : "bg-state-down/80 hover:bg-state-down"
          }`}
        />
      ))}
    </div>
  );
}

function EmptyState({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-brand-glow/25 bg-brand-subtle text-brand-glow">
        <Globe2 className="h-6 w-6" aria-hidden="true" />
      </div>
      <h3 className="mt-5 font-semibold text-ink">
        Votre premier signal commence ici
      </h3>
      <p className="mt-2 max-w-sm text-sm leading-6 text-ink-muted">
        Ajoutez une URL HTTP ou HTTPS. UptimePulse la vérifiera toutes les 5
        minutes et vous montrera son historique.
      </p>
      <button
        onClick={onCreate}
        className="mt-5 inline-flex items-center gap-2 rounded-full bg-brand px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-strong"
      >
        <Plus className="h-4 w-4" aria-hidden="true" />
        Ajouter un monitor
      </button>
    </div>
  );
}

function CreateMonitorModal({
  monitor,
  plan,
  onClose,
  onCreated,
}: {
  monitor: Monitor | null;
  plan: PlanPublic | null;
  onClose: () => void;
  onCreated: () => void;
}) {
  const maxTimeoutMs = plan?.maxTimeoutMs ?? FREE_PLAN.maxTimeoutMs;
  const minIntervalSeconds =
    plan?.minIntervalSeconds ?? FREE_PLAN.minIntervalSeconds;
  const allowKeyword = plan?.allowKeyword ?? false;
  const [name, setName] = useState(monitor?.name ?? "");
  const [url, setUrl] = useState(monitor?.url ?? "");
  const [timeout, setTimeoutValue] = useState(
    String(monitor?.timeoutMs ?? 10000)
  );
  const [keyword, setKeyword] = useState(monitor?.keyword ?? "");
  const [keywordMode, setKeywordMode] = useState<MonitorKeywordMode>(
    monitor?.keywordMode ?? "must_contain"
  );
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<{
    name?: string;
    url?: string;
    timeoutMs?: string;
  }>({});
  const [pending, setPending] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError("");
    setFieldErrors({});
    const body: Record<string, unknown> = {
      name,
      url,
      timeoutMs: Number(timeout),
    };
    // The interval is the plan floor; on an edit it is left alone so lowering
    // or raising the plan cannot silently retime an existing monitor.
    if (!monitor) body.intervalSeconds = minIntervalSeconds;
    // Never sent when the plan forbids it: an absent field keeps the stored
    // rule, an explicit null would destroy it.
    if (allowKeyword) {
      body.keyword = keyword.trim() || null;
      body.keywordMode = keywordMode;
    }
    try {
      await apiRequestUntyped(
        monitor ? `/api/monitors/${monitor.id}` : "/api/monitors",
        {
          method: monitor ? "PUT" : "POST",
          body: JSON.stringify(body),
        }
      );
      onCreated();
    } catch (err) {
      setError(errorMessage(err, "Impossible d’enregistrer ce monitor"));
    } finally {
      setPending(false);
    }
  }

  return (
    <Modal
      title={
        monitor
          ? "Mettre à jour le signal surveillé"
          : "Ajouter un signal à surveiller"
      }
      description="L’URL est vérifiée immédiatement après l’enregistrement, puis à chaque intervalle."
      onClose={onClose}
    >
      <form onSubmit={submit} className="mt-6 space-y-4">
        <label className="block">
          <span className="mb-2 block text-xs font-medium text-ink-soft">
            Nom du service
          </span>
          <input
            required
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="API production"
            aria-invalid={fieldErrors.name ? true : undefined}
            aria-describedby={
              fieldErrors.name ? "monitor-name-error" : undefined
            }
            className="auth-input"
          />
          {fieldErrors.name && (
            <span
              id="monitor-name-error"
              className="mt-1.5 block text-xs text-state-down"
            >
              {fieldErrors.name}
            </span>
          )}
        </label>
        <label className="block">
          <span className="mb-2 block text-xs font-medium text-ink-soft">
            URL HTTP ou HTTPS
          </span>
          <input
            required
            type="url"
            value={url}
            onChange={e => setUrl(e.target.value)}
            placeholder="https://api.exemple.com/health"
            aria-invalid={fieldErrors.url ? true : undefined}
            aria-describedby={
              fieldErrors.url ? "monitor-url-error" : "monitor-url-hint"
            }
            className="auth-input font-mono text-xs"
          />
          {fieldErrors.url ? (
            <span
              id="monitor-url-error"
              className="mt-1.5 block text-xs text-state-down"
            >
              {fieldErrors.url}
            </span>
          ) : (
            <span
              id="monitor-url-hint"
              className="mt-1.5 block text-[11px] text-ink-muted"
            >
              Les IP privées, loopback et redirections vers elles sont bloqués.
            </span>
          )}
        </label>
        <label className="block">
          <span className="mb-2 block text-xs font-medium text-ink-soft">
            Timeout · millisecondes
          </span>
          <input
            required
            type="number"
            min={1000}
            max={maxTimeoutMs}
            step={100}
            value={timeout}
            onChange={e => setTimeoutValue(e.target.value)}
            aria-invalid={fieldErrors.timeoutMs ? true : undefined}
            aria-describedby={
              fieldErrors.timeoutMs ? "monitor-timeout-error" : undefined
            }
            className="auth-input"
          />
          {fieldErrors.timeoutMs && (
            <span
              id="monitor-timeout-error"
              className="mt-1.5 block text-xs text-state-down"
            >
              {fieldErrors.timeoutMs}
            </span>
          )}
        </label>
        {allowKeyword ? (
          <div className="rounded-xl border border-line bg-page p-3">
            <span className="mb-2 block text-xs font-medium text-ink-soft">
              Vérification de contenu (optionnel)
            </span>
            <div className="flex flex-col gap-2 sm:flex-row">
              <select
                value={keywordMode}
                onChange={e =>
                  setKeywordMode(e.target.value as MonitorKeywordMode)
                }
                aria-label="Mode de vérification de contenu"
                className="auth-input sm:w-48"
              >
                {monitorKeywordModeValues.map(value => (
                  <option key={value} value={value}>
                    {monitorKeywordModeLabels[value]}
                  </option>
                ))}
              </select>
              <input
                value={keyword}
                onChange={e => setKeyword(e.target.value)}
                maxLength={160}
                placeholder="« service indisponible »"
                aria-label="Mot-clé recherché dans la réponse"
                className="auth-input flex-1"
              />
            </div>
            <p className="mt-2 text-[11px] leading-5 text-ink-muted">
              Le corps de la réponse est inspecté sur les 256 premiers
              kilo-octets et uniquement pour un contenu texte ou JSON. Laissez
              vide pour ne vérifier que le code HTTP.
            </p>
          </div>
        ) : (
          <p className="rounded-xl border border-line px-3 py-2 text-[11px] leading-5 text-ink-muted">
            La vérification de contenu n’est pas comprise dans le plan{" "}
            {plan?.name ?? "Free"}.
          </p>
        )}
        <p className="rounded-xl border border-brand-glow/25 bg-brand-muted px-3 py-2 text-xs leading-5 text-ink-muted">
          Plan {plan?.name ?? "Free"} : vérification toutes les{" "}
          {minIntervalSeconds / 60} minutes ·{" "}
          {plan?.maxMonitors ?? FREE_PLAN.maxMonitors} monitors maximum.
        </p>
        {error && (
          <p
            role="alert"
            className="rounded-xl border border-state-down/30 bg-state-down/10 px-3 py-2 text-sm text-state-down"
          >
            {error}
          </p>
        )}
        <div className="flex justify-end gap-3 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-full px-4 py-2.5 text-sm text-ink-muted hover:bg-surface-2 hover:text-ink"
          >
            Annuler
          </button>
          <button
            disabled={pending}
            className="rounded-full bg-brand px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-strong disabled:opacity-60"
          >
            {pending
              ? "Enregistrement…"
              : monitor
                ? "Enregistrer les changements"
                : "Créer le monitor"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
