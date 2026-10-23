import {
  ArrowLeft,
  BarChart3,
  Clock3,
  ExternalLink,
  Loader2,
  Lock,
  RefreshCw,
  ShieldCheck,
  TrendingUp,
} from "lucide-react";
import { Link, useLocation, useRoute } from "wouter";
import { useRouteSeo } from "@/lib/seo";
import { useCallback, useEffect, useState } from "react";
import { useAutoRefresh } from "@/hooks/useAutoRefresh";
import {
  api,
  errorMessage,
  formatDuration,
  formatRelativeDate,
  UnauthorizedError,
  type HistoryLog,
  type Monitor,
  type MonitorIncident,
  type User,
} from "@/lib/api";
import { AppShell } from "@/components/uptime/AppShell";
import {
  checkClassificationLabels,
  monitorKeywordModeLabels,
} from "@shared/contracts";
import { Reveal } from "@/components/uptime/Reveal";
import { StatusBadge } from "@/components/uptime/StatusBadge";
import { ErrorState } from "@/components/uptime/PageState";
import { Skeleton } from "@/components/ui/skeleton";
import {
  PeriodSelector,
  type Period,
} from "@/components/uptime/PeriodSelector";
import {
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

export default function MonitorDetail() {
  const [, params] = useRoute("/monitors/:id");
  useRouteSeo({
    title: "Détail du moniteur",
    description:
      "Diagnostic, historique et temps de réponse de ce service surveillé.",
    path: `/monitors/${params?.id ?? ""}`,
    noindex: true,
  });
  const [, navigate] = useLocation();
  const [user, setUser] = useState<User | null>(null);
  const [monitor, setMonitor] = useState<Monitor | null>(null);
  const [logs, setLogs] = useState<HistoryLog[]>([]);
  const [incidents, setIncidents] = useState<MonitorIncident[]>([]);
  const [totalLogs, setTotalLogs] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [period, setPeriod] = useState<Period>("24h");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");

  // `undefined` until the route param is known to be numeric. Interpolating a
  // non-numeric id produced /api/monitors/undefined/... and a 404 loop.
  const rawId = params?.id;
  const id = /^\d+$/.test(rawId ?? "") ? Number(rawId) : null;

  const load = useCallback(
    async (targetPeriod: Period, options: { initial?: boolean } = {}) => {
      if (id === null) {
        setError("Identifiant de monitor invalide.");
        setLoading(false);
        return;
      }
      if (options.initial) setLoading(true);
      else setRefreshing(true);
      try {
        const [auth, detail, history, incidentList] = await Promise.all([
          api.me(),
          api.monitor(id),
          api.history(id, targetPeriod),
          api.incidents(id),
        ]);
        setUser(auth.user);
        setMonitor(detail.monitor);
        setLogs(history.logs);
        setTotalLogs(history.total);
        setHasMore(history.hasMore);
        setIncidents(incidentList.incidents);
        setError("");
      } catch (err) {
        if (err instanceof UnauthorizedError) {
          navigate("/login");
          return;
        }
        setError(errorMessage(err, "Impossible de charger ce monitor"));
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [id, navigate]
  );

  useEffect(() => {
    void load(period, { initial: true });
  }, [load, period]);

  useAutoRefresh(() => load(period), 60_000, !loading);

  async function loadMore() {
    if (id === null || logs.length === 0) return;
    setLoadingMore(true);
    try {
      const cursor = logs[logs.length - 1]?.id;
      const page = await api.history(id, period, cursor);
      setLogs(current => [...current, ...page.logs]);
      setHasMore(page.hasMore);
      setTotalLogs(page.total);
    } catch (err) {
      setError(
        errorMessage(err, "Impossible de charger la suite de l’historique")
      );
    } finally {
      setLoadingMore(false);
    }
  }

  if (loading)
    return (
      <main
        aria-busy="true"
        className="min-h-screen bg-page px-4 py-10 sm:px-6"
      >
        <div className="mx-auto max-w-6xl space-y-7">
          <Skeleton className="h-5 w-40" />
          <div className="space-y-3">
            <Skeleton className="h-9 w-64" />
            <Skeleton className="h-4 w-80" />
          </div>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {[0, 1, 2, 3].map(i => (
              <Skeleton key={i} className="h-24" />
            ))}
          </div>
          <div className="grid gap-5 xl:grid-cols-[1fr_340px]">
            <Skeleton className="h-96" />
            <Skeleton className="h-96" />
          </div>
          <Skeleton className="h-64" />
        </div>
      </main>
    );
  if (!user || !monitor)
    return (
      <ErrorState
        title="Monitor indisponible"
        message={error || "Ce monitor n’a pas pu être chargé."}
        onRetry={() => void load(period, { initial: true })}
      />
    );

  // Failed checks have no response time. Plotting them as 0 ms dragged the
  // curve to zero and misrepresented the service as instantly fast.
  const chartData = [...logs]
    .reverse()
    .filter(log => log.responseTimeMs !== null)
    .map(log => ({
      time: new Intl.DateTimeFormat("fr-FR", {
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      }).format(new Date(log.checkedAt)),
      response: log.responseTimeMs,
      code: log.statusCode,
    }));
  const failureCount = logs.length - chartData.length;

  return (
    <AppShell user={user}>
      <div className="space-y-7">
        <Link
          href="/dashboard"
          className="inline-flex items-center gap-2 text-sm text-ink-muted hover:text-brand-glow"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Retour au dashboard
        </Link>
        <div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-3xl font-semibold tracking-tight text-ink">
                {monitor.name}
              </h1>
              <StatusBadge status={monitor.status} />
            </div>
            <a
              href={monitor.url}
              target="_blank"
              rel="noreferrer"
              className="mt-2 inline-flex items-center gap-1.5 font-mono text-xs text-ink-muted hover:text-brand-glow"
            >
              {monitor.url}
              <ExternalLink className="h-3 w-3" aria-hidden="true" />
            </a>
            {monitor.keyword && (
              <p className="mt-2 text-xs text-ink-muted">
                <span className="text-ink-muted">Règle de contenu&nbsp;: </span>
                {monitorKeywordModeLabels[monitor.keywordMode]} “
                <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[11px] text-brand-glow">
                  {monitor.keyword}
                </code>
                ”
              </p>
            )}
          </div>
          <div className="flex items-center gap-3">
            <PeriodSelector
              value={period}
              onChange={setPeriod}
              disabled={refreshing}
            />
            <button
              onClick={() => void load(period)}
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
          </div>
        </div>
        {error && (
          <p
            role="alert"
            className="rounded-xl border border-state-down/30 bg-state-down/10 px-4 py-3 text-sm text-state-down"
          >
            {error}
          </p>
        )}
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <DetailKpi
            icon={<TrendingUp className="h-4 w-4" aria-hidden="true" />}
            label="Uptime · 30 jours"
            value={
              monitor.uptimePercent === null
                ? "—"
                : `${monitor.uptimePercent.toFixed(2)}%`
            }
          />
          <DetailKpi
            icon={<Clock3 className="h-4 w-4" aria-hidden="true" />}
            label="Réponse moyenne"
            value={
              monitor.averageResponseTimeMs === null
                ? "—"
                : `${monitor.averageResponseTimeMs} ms`
            }
          />
          <DetailKpi
            icon={<BarChart3 className="h-4 w-4" aria-hidden="true" />}
            label="Checks enregistrés"
            value={String(totalLogs)}
          />
          <DetailKpi
            icon={<ShieldCheck className="h-4 w-4" aria-hidden="true" />}
            label="Dernier check"
            value={formatRelativeDate(monitor.lastCheckAt)}
          />
        </div>
        <Reveal>
          <TechnicalAnalysis monitor={monitor} logs={logs} />
        </Reveal>
        <div className="grid gap-5 xl:grid-cols-[1fr_340px]">
          <section className="rounded-2xl border border-line bg-surface p-5 sm:p-6 shadow-soft">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="font-semibold text-ink">Temps de réponse</h2>
                <p className="mt-1 text-xs text-ink-muted">
                  Uniquement les checks qui ont répondu
                  {failureCount > 0 && ` · ${failureCount} en échec exclus`}
                </p>
              </div>
              <span className="rounded-lg bg-brand-subtle px-2 py-1 text-xs text-brand-glow">
                {chartData.length} points
              </span>
            </div>
            <div className="mt-8 h-[300px]">
              {chartData.length > 0 ? (
                <figure
                  role="img"
                  // ResponsiveContainer resolves height:100% against this box;
                  // without a definite height the chart collapses to 0.
                  className="h-full"
                  aria-label={`Temps de réponse sur ${chartData.length} checks, de ${Math.min(
                    ...chartData.map(point => point.response as number)
                  )} à ${Math.max(
                    ...chartData.map(point => point.response as number)
                  )} millisecondes`}
                >
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={chartData}>
                      <XAxis
                        dataKey="time"
                        tick={{ fill: "#7a7873", fontSize: 10 }}
                        axisLine={false}
                        tickLine={false}
                        minTickGap={30}
                      />
                      <YAxis
                        tick={{ fill: "#7a7873", fontSize: 10 }}
                        axisLine={false}
                        tickLine={false}
                        width={42}
                        unit="ms"
                      />
                      <Tooltip
                        contentStyle={{
                          background: "#fbfaf7",
                          border: "1px solid #e3e1d8",
                          borderRadius: 12,
                          fontSize: 12,
                        }}
                        labelStyle={{ color: "#7a7873" }}
                      />
                      <Line
                        type="monotone"
                        dataKey="response"
                        stroke="#e8503a"
                        strokeWidth={2}
                        dot={false}
                        activeDot={{
                          r: 4,
                          fill: "#e8503a",
                          stroke: "#fbfaf7",
                          strokeWidth: 2,
                        }}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </figure>
              ) : (
                <div className="flex h-full items-center justify-center text-sm text-ink-muted">
                  Les premières données apparaîtront après le prochain check.
                </div>
              )}
            </div>
          </section>
          <section className="rounded-2xl border border-line bg-surface p-5 sm:p-6 shadow-soft">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="font-semibold text-ink">Incidents</h2>
                <p className="mt-1 text-xs text-ink-muted">
                  Historique des transitions
                </p>
              </div>
              <span className="text-xs text-ink-muted">{incidents.length}</span>
            </div>
            {incidents.length === 0 ? (
              <div className="mt-8 text-sm leading-6 text-ink-muted">
                Aucun incident enregistré sur cette période.
              </div>
            ) : (
              <div className="mt-5 space-y-3">
                {incidents.slice(0, 6).map(incident => (
                  <div
                    key={incident.id}
                    className="rounded-xl border border-line bg-page p-3"
                  >
                    <div className="flex items-center justify-between">
                      <span
                        className={`text-xs font-medium ${incident.status === "resolved" ? "text-state-up" : "text-state-down"}`}
                      >
                        {incident.status === "resolved" ? "Résolu" : "Confirmé"}
                      </span>
                      <span className="text-[11px] text-ink-muted">
                        {formatRelativeDate(incident.startedAt)}
                      </span>
                    </div>
                    <p className="mt-2 text-xs text-ink-muted">
                      {incident.reason || "Échec du check"}
                    </p>
                    {incident.durationSeconds !== null && (
                      <p className="mt-2 font-mono text-[11px] text-ink-muted">
                        Durée · {formatDuration(incident.durationSeconds)}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
        <section className="overflow-hidden rounded-2xl border border-line bg-surface shadow-soft">
          <div className="flex items-center justify-between border-b border-line px-5 py-5 sm:px-6">
            <div>
              <h2 className="font-semibold text-ink">Derniers checks</h2>
              <p className="mt-1 text-xs text-ink-muted">
                Code HTTP, classification et temps de réponse
              </p>
            </div>
            <span className="text-xs text-ink-muted">
              {logs.length} / {totalLogs}
            </span>
          </div>
          <div className="divide-y divide-line">
            {logs.slice(0, 8).map(log => (
              <div
                key={log.id}
                className="grid grid-cols-[1fr_auto_auto] items-center gap-4 px-5 py-3 text-sm sm:grid-cols-[1.4fr_0.7fr_1fr_auto]"
              >
                <div className="flex items-center gap-2">
                  <span
                    className={`h-1.5 w-1.5 rounded-full ${log.isUp ? "bg-state-up" : "bg-state-down"}`}
                    aria-hidden="true"
                  />
                  <span className="text-ink-soft">
                    {formatRelativeDate(log.checkedAt)}
                  </span>
                  <span className="sr-only">
                    {log.isUp ? "Succès" : "Échec"}
                  </span>
                </div>
                <span
                  className={`font-mono text-xs ${log.isUp ? "text-state-up" : "text-state-down"}`}
                >
                  {log.statusCode ?? "—"}
                </span>
                <span
                  className="hidden text-[11px] text-ink-muted sm:block"
                  title={log.classification}
                >
                  {checkClassificationLabels[log.classification]}
                </span>
                <span className="font-mono text-xs text-ink-muted">
                  {log.responseTimeMs === null
                    ? "—"
                    : `${log.responseTimeMs} ms`}
                </span>
                {/* The content audit note: a non-text body or a truncated read
                    leaves the verdict inconclusive without failing the check. */}
                {log.errorMessage && (
                  <span className="col-span-full text-[11px] leading-5 text-ink-muted">
                    {log.errorMessage}
                  </span>
                )}
              </div>
            ))}
            {logs.length === 0 && (
              <div className="px-5 py-10 text-center text-sm text-ink-muted">
                Aucun check enregistré.
              </div>
            )}
          </div>
          {hasMore && (
            <div className="border-t border-line px-5 py-4 text-center">
              <button
                onClick={() => void loadMore()}
                disabled={loadingMore}
                className="inline-flex items-center gap-2 rounded-full border border-line px-4 py-2 text-sm text-ink-soft hover:bg-surface-2 disabled:opacity-60"
              >
                {loadingMore && (
                  <Loader2
                    className="h-4 w-4 animate-spin"
                    aria-hidden="true"
                  />
                )}
                Charger plus de checks
              </button>
            </div>
          )}
        </section>
      </div>
    </AppShell>
  );
}

function DetailKpi({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-2xl border border-line bg-surface p-4 shadow-soft">
      <div className="flex items-center gap-2 text-brand-glow">
        {icon}
        <span className="text-xs text-ink-muted">{label}</span>
      </div>
      <div className="mt-3 text-lg font-semibold text-ink">{value}</div>
    </div>
  );
}

function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return Math.round(
    values.reduce((sum, value) => sum + value, 0) / values.length
  );
}

function quantile(sorted: number[], q: number): number | null {
  if (sorted.length === 0) return null;
  const index = Math.max(
    0,
    Math.min(sorted.length - 1, Math.ceil(q * sorted.length) - 1)
  );
  return sorted[index];
}

function TechnicalAnalysis({
  monitor,
  logs,
}: {
  monitor: Monitor;
  logs: HistoryLog[];
}) {
  const timed = logs.filter(
    log => log.ttfbMs !== null && log.responseTimeMs !== null
  );
  const segments = [
    {
      label: "Résolution DNS",
      value: average(
        timed.flatMap(log => (log.dnsMs === null ? [] : [log.dnsMs]))
      ),
      bar: "bg-sky-500/80",
      dot: "bg-sky-400",
    },
    {
      label: "Connexion TCP",
      value: average(
        timed.flatMap(log => (log.tcpMs === null ? [] : [log.tcpMs]))
      ),
      bar: "bg-brand-glow/80",
      dot: "bg-brand-glow",
    },
    {
      label: "Handshake TLS",
      value: average(
        timed.flatMap(log => (log.tlsMs === null ? [] : [log.tlsMs]))
      ),
      bar: "bg-violet-400/80",
      dot: "bg-violet-300",
    },
    {
      label: "Attente serveur (TTFB)",
      value: average(
        timed.flatMap(log => (log.ttfbMs === null ? [] : [log.ttfbMs]))
      ),
      bar: "bg-state-up/80",
      dot: "bg-state-up",
    },
    {
      label: "Transfert du contenu",
      value: average(
        timed.flatMap(log =>
          log.responseTimeMs !== null && log.ttfbMs !== null
            ? [Math.max(0, log.responseTimeMs - log.ttfbMs)]
            : []
        )
      ),
      bar: "bg-slate-500/80",
      dot: "bg-slate-400",
    },
  ];
  const visible = segments.filter(segment => segment.value !== null);
  const total = visible.reduce((sum, segment) => sum + (segment.value ?? 0), 0);

  const latencies = logs
    .flatMap(log => (log.responseTimeMs === null ? [] : [log.responseTimeMs]))
    .sort((a, b) => a - b);
  const p50 = quantile(latencies, 0.5);
  const p95 = quantile(latencies, 0.95);

  const ssl = monitor.ssl;
  const isHttps = monitor.url.startsWith("https://");
  const daysLeft =
    ssl?.validTo === null || ssl?.validTo === undefined
      ? null
      : Math.floor((new Date(ssl.validTo).getTime() - Date.now()) / 86_400_000);
  const badgeClass =
    !ssl || daysLeft === null
      ? "border-line-strong bg-surface-2 text-ink-soft"
      : daysLeft < 0 || daysLeft <= 14
        ? "border-state-down/30 bg-state-down/10 text-state-down"
        : daysLeft <= 30
          ? "border-state-warn/30 bg-state-warn/10 text-state-warn"
          : "border-state-up/30 bg-state-up/10 text-state-up";

  return (
    <section className="rounded-2xl border border-line bg-surface p-5 sm:p-6 shadow-soft">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-semibold text-ink">Analyse technique</h2>
          <p className="mt-1 text-xs text-ink-muted">
            Décomposition réseau moyennée sur {timed.length} check(s) de la
            période
          </p>
        </div>
        <span className="rounded-lg bg-brand-subtle px-2 py-1 font-mono text-xs text-brand-glow">
          p50 {p50 === null ? "—" : `${p50} ms`} · p95{" "}
          {p95 === null ? "—" : `${p95} ms`}
        </span>
      </div>
      <div className="mt-5 grid gap-5 lg:grid-cols-[1fr_320px]">
        <div>
          {visible.length > 0 ? (
            <>
              <div
                role="img"
                aria-label={`Latence moyenne : ${visible
                  .map(segment => `${segment.label} ${segment.value} ms`)
                  .join(", ")}`}
                className="flex h-3 w-full overflow-hidden rounded-full bg-page"
              >
                {visible.map(segment => (
                  <div
                    key={segment.label}
                    className={`analysis-segment ${segment.bar}`}
                    style={{
                      width: `${((segment.value ?? 0) / total) * 100}%`,
                    }}
                  />
                ))}
              </div>
              <ul className="mt-4 grid gap-x-6 gap-y-2 sm:grid-cols-2">
                {visible.map(segment => (
                  <li
                    key={segment.label}
                    className="flex items-center gap-2 text-xs text-ink-muted"
                  >
                    <span
                      className={`h-2 w-2 shrink-0 rounded-full ${segment.dot}`}
                      aria-hidden="true"
                    />
                    {segment.label}
                    <span className="ml-auto font-mono text-ink-soft">
                      {segment.value} ms
                    </span>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p className="text-sm leading-6 text-ink-muted">
              Les phases réseau (DNS, TCP, TLS, premier octet) apparaîtront
              après les prochains checks.
            </p>
          )}
        </div>
        <div className="rounded-xl border border-line bg-page p-4">
          <div className="flex items-center gap-2">
            <Lock className="h-4 w-4 text-brand-glow" aria-hidden="true" />
            <h3 className="text-sm font-medium text-ink">Certificat TLS</h3>
          </div>
          {ssl ? (
            <dl className="mt-3 space-y-2.5 text-xs">
              <div>
                <dt className="text-ink-muted">Sujet</dt>
                <dd
                  className="mt-0.5 truncate font-mono text-ink-soft"
                  title={ssl.subject}
                >
                  {ssl.subject}
                </dd>
              </div>
              <div>
                <dt className="text-ink-muted">Émetteur</dt>
                <dd
                  className="mt-0.5 truncate font-mono text-ink-soft"
                  title={ssl.issuer}
                >
                  {ssl.issuer}
                </dd>
              </div>
              <div className="pt-1">
                <span
                  className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium ${badgeClass}`}
                >
                  {daysLeft === null
                    ? "Date de fin illisible"
                    : daysLeft < 0
                      ? `Expiré depuis ${-daysLeft} jour(s)`
                      : `Expire dans ${daysLeft} jour(s)`}
                </span>
              </div>
            </dl>
          ) : isHttps ? (
            <p className="mt-3 text-xs leading-5 text-ink-muted">
              En attente d’un check HTTPS réussi pour lire le certificat.
            </p>
          ) : (
            <p className="mt-3 text-xs leading-5 text-ink-muted">
              Cible en HTTP simple : aucun certificat à surveiller.{" "}
              <span className="text-state-warn">Envisagez du HTTPS.</span>
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
