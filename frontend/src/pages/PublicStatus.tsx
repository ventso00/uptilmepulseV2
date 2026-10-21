import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useRoute } from "wouter";
import {
  ArrowRight,
  CircleCheck,
  CircleX,
  Clock3,
  ExternalLink,
  MessageSquareWarning,
  ShieldAlert,
  TriangleAlert,
} from "lucide-react";
import { checkClassificationLabels } from "@shared/contracts";
import { ApiError, api, type PublicStatusData } from "@/lib/api";
import { Logo } from "@/components/uptime/Logo";
import { ReportIssueDialog } from "@/components/uptime/ReportIssueDialog";
import { StatusBadge } from "@/components/uptime/StatusBadge";
import { Reveal } from "@/components/uptime/Reveal";
import { Skeleton } from "@/components/ui/skeleton";
import { useAutoRefresh } from "@/hooks/useAutoRefresh";
import {
  AvailabilityWindows,
  CertificateCard,
  CoverageCard,
  FailureCauses,
  HourlyStrip,
  IncidentStats,
  IncidentTimeline,
  LatencyChart,
  LatencyDistribution,
  MethodologyPanel,
  PhaseBreakdown,
  SummaryStrip,
  formatDateTime,
  formatDuration,
  formatMs,
  formatPercent,
  type MonitorMetrics,
} from "@/components/uptime/status/StatusAnalytics";

function formatDate(date: string): string {
  return new Intl.DateTimeFormat("fr-FR", {
    day: "2-digit",
    month: "short",
  }).format(new Date(`${date}T12:00:00Z`));
}

function formatTime(value: string | Date | null): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("fr-FR", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

/** Day buckets for the last `count` UTC calendar days, oldest first. */
function buildCalendar(
  days: PublicStatusData["monitors"][number]["days"],
  count: number
) {
  const byDate = new Map(days.map(day => [day.date, day]));
  const buckets: {
    date: string;
    up: number;
    down: number;
    hasData: boolean;
  }[] = [];
  const today = new Date();
  for (let offset = count - 1; offset >= 0; offset -= 1) {
    const date = new Date(today);
    date.setUTCDate(date.getUTCDate() - offset);
    const key = date.toISOString().slice(0, 10);
    const bucket = byDate.get(key);
    buckets.push({
      date: key,
      up: bucket?.up ?? 0,
      down: bucket?.down ?? 0,
      hasData: bucket !== undefined,
    });
  }
  return buckets;
}

function dayColor(bucket: { up: number; down: number; hasData: boolean }) {
  if (!bucket.hasData) return "bg-surface-2";
  if (bucket.down === 0) return "bg-state-up";
  if (bucket.up === 0) return "bg-state-down";
  return "bg-state-warn";
}

function dayLabel(bucket: {
  date: string;
  up: number;
  down: number;
  hasData: boolean;
}) {
  if (!bucket.hasData) return `${formatDate(bucket.date)} — aucun check`;
  return `${formatDate(bucket.date)} — ${bucket.up} check(s) en ligne, ${bucket.down} en échec`;
}

function StatusLegend() {
  const items = [
    { color: "bg-state-up", label: "Période sans échec" },
    { color: "bg-state-warn", label: "Échecs partiels" },
    { color: "bg-state-down", label: "Majorité d’échecs" },
    { color: "bg-surface-2", label: "Aucun check (encore)" },
  ];
  return (
    <ul
      aria-label="Légende des calendriers"
      className="flex flex-wrap items-center gap-x-5 gap-y-2 rounded-2xl border border-line bg-surface px-5 py-3 text-xs text-ink-soft"
    >
      {items.map(item => (
        <li key={item.label} className="flex items-center gap-2">
          <span
            className={`h-3 w-3 rounded-sm ${item.color}`}
            aria-hidden="true"
          />
          {item.label}
        </li>
      ))}
      <li className="flex items-center gap-2">
        <span className="h-3 w-0.5 bg-brand" aria-hidden="true" />
        Objectif 99,9 %
      </li>
    </ul>
  );
}

function openIncidents(data: PublicStatusData) {
  return data.incidents.filter(
    incident => incident.status === "confirmed" && !incident.resolvedAt
  );
}

/**
 * The one line a non-technical reader came for. Every number here is already on
 * the page: it reuses the payload's own aggregates instead of recomputing — and
 * never states a cause the checks did not measure.
 */
function verdictOf(data: PublicStatusData): string {
  const open = openIncidents(data);
  const measuredChecks = data.monitors.reduce(
    (total, monitor) => total + monitor.coverage.totalChecks,
    0
  );
  if (data.overall === "outage") {
    const subject =
      open.length > 0
        ? `${open[0].monitorName}${open.length > 1 ? ` et ${open.length - 1} autre(s)` : ""}`
        : "un service";
    const since = open[0]?.startedAt ? formatTime(open[0].startedAt) : null;
    return `Un problème en cours : ${subject} ne répond pas${since ? ` depuis ${since}` : ""}. Les autres services listés ci-dessous fonctionnent.`;
  }
  if (data.overall !== "operational") {
    return "Aucun service n’est encore surveillé sur cette page : les mesures apparaîtront au premier check.";
  }
  const slowest = data.monitors
    .map(monitor => monitor.latency.p95Ms)
    .filter((value): value is number => value !== null)
    .sort((a, b) => b - a)[0];
  return `Tout répond${
    data.monitors.length > 1
      ? ` — ${data.monitors.length} services contrôlés`
      : ""
  }. Disponibilité ${formatPercent(
    data.summary.globalUptimePercent
  )} sur ${data.methodology.windowDays} jours (${measuredChecks} mesure${
    measuredChecks > 1 ? "s" : ""
  })${
    slowest !== undefined
      ? `, pire temps de réponse observé ${formatMs(slowest)}`
      : ""
  }.`;
}

type Severity = "critical" | "warn" | "info";

interface Problem {
  key: string;
  severity: Severity;
  title: string;
  detail: string;
}

/**
 * Plain-French translation of everything the payload reports as abnormal. One
 * entry per observed fact, in the order a reader should fix them.
 */
function problemsOf(data: PublicStatusData): Problem[] {
  const problems: Problem[] = [];
  const openByMonitor = new Map(
    openIncidents(data).map(incident => [incident.monitorName, incident])
  );

  for (const monitor of data.monitors) {
    const open = openByMonitor.get(monitor.name);
    if (monitor.status === "DOWN" || open) {
      const reason = open?.reason
        ? ` Erreur mesurée : ${open.reason.toLowerCase()}.`
        : "";
      problems.push({
        key: `${monitor.id}-down`,
        severity: "critical",
        title: `${monitor.name} est injoignable`,
        detail: `Confirmé après ${data.methodology.failureThreshold} échecs consécutifs${
          open?.startedAt
            ? ` depuis ${formatDateTime(open.startedAt)} (${formatDuration(open.elapsedSeconds)})`
            : ""
        }.${reason}`,
      });
    }

    if (monitor.coverage.totalChecks === 0) {
      problems.push({
        key: `${monitor.id}-nocoverage`,
        severity: "info",
        title: `${monitor.name} n’a encore aucune mesure`,
        detail: monitor.nextCheckAt
          ? `Premier check prévu à ${formatTime(monitor.nextCheckAt) ?? "bientôt"}.`
          : "La surveillance est en pause sur ce service.",
      });
      continue;
    }

    const failedChecks = monitor.failures.reduce(
      (sum, failure) => sum + failure.count,
      0
    );
    if (failedChecks > 0 && !open) {
      const causes = monitor.failures
        .map(
          failure =>
            `${checkClassificationLabels[failure.classification] ?? failure.classification} (${failure.count})`
        )
        .join(", ");
      problems.push({
        key: `${monitor.id}-failures`,
        severity: "warn",
        title: `${monitor.name} a été interrompu ${failedChecks} fois`,
        detail: `Sur ${monitor.incidents.windowDays} jours — causes relevées : ${causes}. Aucun incident n’est ouvert actuellement.`,
      });
    }

    const day1 = monitor.windows.d1.uptimePercent;
    if (day1 !== null && day1 < monitor.sla.targetPercent && !open) {
      problems.push({
        key: `${monitor.id}-d1`,
        severity: "warn",
        title: `${monitor.name} est sous l’objectif sur 24 h`,
        detail: `${formatPercent(day1, 1)} de disponibilité mesurée, objectif ${monitor.sla.targetPercent
          .toString()
          .replace(".", ",")} %.`,
      });
    }

    const certificate = monitor.certificate;
    if (certificate && certificate.daysRemaining <= 14) {
      problems.push({
        key: `${monitor.id}-cert`,
        severity: certificate.daysRemaining < 0 ? "critical" : "warn",
        title:
          certificate.daysRemaining < 0
            ? `Le certificat HTTPS de ${monitor.name} est expiré`
            : `Le certificat HTTPS de ${monitor.name} expire bientôt`,
        detail:
          certificate.daysRemaining < 0
            ? `Expiré depuis ${Math.abs(certificate.daysRemaining)} jour(s) — échéance ${formatDateTime(certificate.validTo)}.`
            : `Encore ${certificate.daysRemaining} jour(s) — échéance ${formatDateTime(certificate.validTo)}.`,
      });
    }

    const trend = monitor.latency.trendPercent;
    if (trend !== null && trend >= 10) {
      problems.push({
        key: `${monitor.id}-slow`,
        severity: "info",
        title: `${monitor.name} répond plus lentement`,
        detail: `+${trend.toFixed(1).replace(".", ",")} % de latence par rapport aux 7 jours précédents (p95 ${formatMs(monitor.latency.p95Ms)}).`,
      });
    }
  }

  const rank: Record<Severity, number> = { critical: 0, warn: 1, info: 2 };
  return problems.sort((a, b) => rank[a.severity] - rank[b.severity]);
}

const SEVERITY_STYLE: Record<
  Severity,
  { chip: string; iconClass: string; icon: typeof CircleX; label: string }
> = {
  critical: {
    chip: "border-state-down/30 bg-state-down/10 text-state-down",
    iconClass: "text-state-down",
    icon: CircleX,
    label: "Bloquant",
  },
  warn: {
    chip: "border-state-warn/30 bg-state-warn/10 text-state-warn",
    iconClass: "text-state-warn",
    icon: TriangleAlert,
    label: "À surveiller",
  },
  info: {
    chip: "border-brand/25 bg-brand/5 text-brand-strong",
    iconClass: "text-brand",
    icon: Clock3,
    label: "Information",
  },
};

function VerdictCard({ data }: { data: PublicStatusData }) {
  const open = openIncidents(data);
  const measuredChecks = data.monitors.reduce(
    (total, monitor) => total + monitor.coverage.totalChecks,
    0
  );
  const tone =
    data.overall === "outage"
      ? "border-state-down/25 bg-state-down/[0.06]"
      : data.overall === "operational"
        ? "border-state-up/25 bg-state-up/[0.06]"
        : "border-line bg-page";
  const iconTone =
    data.overall === "outage"
      ? "text-state-down"
      : data.overall === "operational"
        ? "text-state-up"
        : "text-ink-muted";
  return (
    <div
      className={`relative overflow-hidden rounded-2xl border p-6 shadow-sm shadow-brand/5 ${tone}`}
    >
      <span
        className="animate-sheen pointer-events-none absolute inset-y-0 left-0 w-1/4 bg-gradient-to-r from-transparent via-white/55 to-transparent"
        aria-hidden="true"
      />
      <div className="relative flex flex-wrap items-start gap-4">
        <span
          className="relative mt-1 flex h-3 w-3 shrink-0"
          aria-hidden="true"
        >
          {data.overall === "operational" && (
            <span className="live-ping absolute inline-flex h-full w-full rounded-full bg-state-up" />
          )}
          <span
            className={`relative inline-flex h-3 w-3 rounded-full ${
              data.overall === "outage"
                ? "bg-state-down"
                : data.overall === "operational"
                  ? "bg-state-up"
                  : "bg-ink-muted"
            }`}
          />
        </span>
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-ink-muted">
            <span className={iconTone} aria-hidden="true">
              {data.overall === "outage" ? (
                <CircleX className="h-4 w-4" />
              ) : data.overall === "operational" ? (
                <CircleCheck className="h-4 w-4" />
              ) : (
                <ShieldAlert className="h-4 w-4" />
              )}
            </span>
            Verdict
          </p>
          <p className="mt-2 text-lg font-semibold leading-snug text-ink sm:text-xl">
            {verdictOf(data)}
          </p>
          {open.length > 0 ? (
            <ul className="mt-3 space-y-1 text-sm text-ink-soft">
              {open.map(incident => (
                <li key={incident.id}>
                  <span className="font-medium text-ink">
                    {incident.monitorName}
                  </span>{" "}
                  — depuis {formatDateTime(incident.startedAt)} (
                  {formatDuration(incident.elapsedSeconds)})
                  {incident.reason ? ` · ${incident.reason}` : ""}
                </li>
              ))}
            </ul>
          ) : null}
          <p className="mt-3 text-xs text-ink-muted">
            {data.overall === "operational"
              ? `Aucun incident confirmé en cours · ${measuredChecks} mesure${
                  measuredChecks > 1 ? "s" : ""
                } sur ${data.monitors.length} service${
                  data.monitors.length > 1 ? "s" : ""
                }.`
              : `Alerte envoyée automatiquement après ${data.methodology.failureThreshold} échecs consécutifs.`}
          </p>
        </div>
      </div>
    </div>
  );
}

/** The client-facing answer to "what is wrong with my site", in one list. */
function ProblemList({
  data,
  windowDays,
}: {
  data: PublicStatusData;
  windowDays: number;
}) {
  const problems = useMemo(() => problemsOf(data), [data]);
  return (
    <section
      aria-labelledby="problems-heading"
      className="rounded-2xl border border-line bg-surface p-5 shadow-sm shadow-brand/5"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2
          id="problems-heading"
          className="flex items-center gap-2 text-sm font-semibold text-ink"
        >
          <TriangleAlert className="h-4 w-4 text-brand" aria-hidden="true" />
          Problèmes rencontrés
        </h2>
        <p className="text-[11px] text-ink-muted">
          {problems.length === 0
            ? `sur ${windowDays} jours de mesures`
            : `${problems.length} élément${problems.length > 1 ? "s" : ""} relevé${
                problems.length > 1 ? "s" : ""
              } sur ${windowDays} jours`}
        </p>
      </div>

      {problems.length === 0 ? (
        <p className="mt-4 flex items-center gap-2 text-sm text-state-up">
          <CircleCheck className="h-4 w-4" aria-hidden="true" />
          Rien à signaler : aucun échec, aucun incident, aucun certificat en
          risque sur la période.
        </p>
      ) : (
        <ul className="mt-4 space-y-3">
          {problems.map(problem => {
            const style = SEVERITY_STYLE[problem.severity];
            const Icon = style.icon;
            return (
              <li
                key={problem.key}
                className="animate-rise rounded-xl border border-line bg-page px-4 py-3"
              >
                <p className="flex flex-wrap items-center gap-2 text-sm font-semibold text-ink">
                  <Icon
                    className={`h-4 w-4 shrink-0 ${style.iconClass}`}
                    aria-hidden="true"
                  />
                  {problem.title}
                  <span
                    className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${style.chip}`}
                  >
                    {style.label}
                  </span>
                </p>
                <p className="mt-1 text-xs leading-5 text-ink-soft">
                  {problem.detail}
                </p>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/** Service status matrix: one row per service, the columns an operator scans. */
function StatusMatrix({ data }: { data: PublicStatusData }) {
  return (
    <section className="rounded-2xl border border-line bg-surface p-5 shadow-sm shadow-brand/5">
      <h2 className="text-sm font-semibold text-ink">
        Comparaison des services
      </h2>
      <p className="mt-1 text-[11px] text-ink-muted">
        Disponibilité par fenêtre, latence de tête, incidents et expiration du
        certificat — sur la même ligne, pour comparer sans calculer.
      </p>
      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[640px] text-left text-xs">
          <caption className="sr-only">
            État comparé des services surveillés
          </caption>
          <thead>
            <tr className="text-[10px] uppercase tracking-[0.12em] text-ink-muted">
              <th scope="col" className="pb-2 font-semibold">
                Service
              </th>
              <th scope="col" className="pb-2 text-right font-semibold">
                24 h
              </th>
              <th scope="col" className="pb-2 text-right font-semibold">
                7 j
              </th>
              <th scope="col" className="pb-2 text-right font-semibold">
                30 j
              </th>
              <th scope="col" className="pb-2 text-right font-semibold">
                {data.methodology.windowDays} j
              </th>
              <th scope="col" className="pb-2 text-right font-semibold">
                p50
              </th>
              <th scope="col" className="pb-2 text-right font-semibold">
                p95
              </th>
              <th scope="col" className="pb-2 text-right font-semibold">
                Incidents
              </th>
              <th scope="col" className="pb-2 text-right font-semibold">
                Certif.
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {data.monitors.map(monitor => (
              <tr key={monitor.id}>
                <th scope="row" className="py-2 pr-3 font-medium text-ink">
                  <span className="flex items-center gap-2">
                    <span
                      className={`h-2 w-2 rounded-full ${
                        monitor.status === "UP"
                          ? "bg-state-up"
                          : monitor.status === "DOWN"
                            ? "bg-state-down"
                            : "bg-ink-muted/50"
                      }`}
                      aria-hidden="true"
                    />
                    <span className="truncate">{monitor.name}</span>
                  </span>
                </th>
                <td className="metric py-2 text-right text-ink-soft">
                  {formatPercent(monitor.windows.d1.uptimePercent, 1)}
                </td>
                <td className="metric py-2 text-right text-ink-soft">
                  {formatPercent(monitor.windows.d7.uptimePercent, 1)}
                </td>
                <td className="metric py-2 text-right text-ink-soft">
                  {formatPercent(monitor.windows.d30.uptimePercent, 1)}
                </td>
                <td className="metric py-2 text-right font-semibold text-ink">
                  {formatPercent(monitor.windows.d90.uptimePercent)}
                </td>
                <td className="metric py-2 text-right text-ink-soft">
                  {formatMs(monitor.latency.p50Ms)}
                </td>
                <td className="metric py-2 text-right text-ink-soft">
                  {formatMs(monitor.latency.p95Ms)}
                </td>
                <td className="metric py-2 text-right text-ink-soft">
                  {monitor.incidents.confirmedCount}
                  <span className="text-ink-muted">
                    {" "}
                    · {formatDuration(monitor.incidents.totalDowntimeSeconds)}
                  </span>
                </td>
                <td
                  className={`metric py-2 text-right ${
                    !monitor.certificate
                      ? "text-ink-muted"
                      : monitor.certificate.daysRemaining <= 14
                        ? "text-state-down"
                        : monitor.certificate.daysRemaining <= 30
                          ? "text-state-warn"
                          : "text-ink-soft"
                  }`}
                >
                  {monitor.certificate
                    ? `${monitor.certificate.daysRemaining} j`
                    : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function ServiceAnalysis({
  monitor,
  windowDays,
}: {
  monitor: MonitorMetrics;
  windowDays: number;
}) {
  const buckets = buildCalendar(monitor.days, windowDays);
  // The published window is 90 days, but a monitor created this morning only
  // holds today's checks. Labelling its ratio "uptime 90 j" would claim three
  // months of history that was never measured, so the label follows the data.
  const firstDataDate = monitor.days.length > 0 ? monitor.days[0].date : null;
  const partialWindow =
    firstDataDate !== null && firstDataDate > buckets[0].date;
  const uptimeLabel = partialWindow
    ? `uptime depuis le ${formatDate(firstDataDate)}`
    : `uptime ${windowDays} j`;
  return (
    <section
      aria-labelledby={`service-${monitor.id}`}
      className="rounded-2xl border border-line bg-surface p-5 shadow-sm shadow-brand/5"
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 items-start gap-3">
          <StatusBadge status={monitor.status} />
          <div className="min-w-0">
            <h3
              id={`service-${monitor.id}`}
              className="truncate font-semibold text-ink"
            >
              {monitor.name}
            </h3>
            <a
              href={monitor.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex max-w-full items-center gap-1 text-xs text-ink-muted hover:text-brand"
            >
              <span className="truncate">{monitor.url}</span>
              <ExternalLink className="h-3 w-3 shrink-0" aria-hidden="true" />
            </a>
          </div>
        </div>
        <div className="text-right">
          {monitor.status === "UNKNOWN" && monitor.nextCheckAt ? (
            <p className="text-sm text-ink-soft">
              Premier check prévu à{" "}
              <span className="font-semibold text-ink">
                {formatTime(monitor.nextCheckAt) ?? "bientôt"}
              </span>
            </p>
          ) : (
            <>
              <p className="metric text-2xl font-semibold text-ink">
                {formatPercent(monitor.uptimePercent)}
              </p>
              <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-muted">
                {uptimeLabel} · {monitor.coverage.totalChecks} checks
              </p>
            </>
          )}
        </div>
      </div>

      <div className="mt-5 space-y-4">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-muted">
            {windowDays} derniers jours
          </p>
          <div
            className="mt-2 flex h-8 items-stretch gap-[3px]"
            role="img"
            aria-label={`Historique d'uptime de ${monitor.name} sur ${windowDays} jours : ${
              monitor.uptimePercent === null
                ? "aucune donnée"
                : `${monitor.uptimePercent.toFixed(2)} % d'uptime`
            }`}
          >
            {buckets.map(bucket => (
              <span
                key={bucket.date}
                title={dayLabel(bucket)}
                className={`min-w-0 flex-1 rounded-sm ${dayColor(bucket)}`}
              />
            ))}
          </div>
        </div>
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-muted">
            24 dernières heures, heure par heure
          </p>
          <div className="mt-2">
            <HourlyStrip monitor={monitor} />
          </div>
        </div>
      </div>

      <div className="mt-5 grid gap-4 lg:grid-cols-2">
        <AvailabilityWindows monitor={monitor} />
        <LatencyDistribution monitor={monitor} />
        <PhaseBreakdown monitor={monitor} />
        <LatencyChart monitor={monitor} />
        <FailureCauses monitor={monitor} />
        <IncidentStats monitor={monitor} />
        <CertificateCard monitor={monitor} />
        <CoverageCard monitor={monitor} />
      </div>
    </section>
  );
}

export default function PublicStatus() {
  const [, params] = useRoute("/status/:slug");
  const slug = params?.slug ?? "";
  const [data, setData] = useState<PublicStatusData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);

  const load = useCallback(async () => {
    if (!slug) return;
    try {
      const result = await api.publicStatus(slug);
      setData(result);
      setError(null);
      setNotFound(false);
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) setNotFound(true);
      setError(err instanceof Error ? err.message : "Erreur inconnue");
    }
  }, [slug]);

  useEffect(() => {
    void load();
  }, [load]);
  useAutoRefresh(load, 60_000, data !== null);

  if (!slug) return null;

  return (
    <div className="min-h-screen bg-page font-sans text-ink">
      <header className="sticky top-0 z-30 border-b border-line/80 bg-surface/85 backdrop-blur-md">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 px-5 py-4">
          <Link href="/" className="flex items-center gap-2.5">
            <Logo className="h-8 w-8" />
            <span className="font-semibold tracking-tight text-ink">
              Page de statut
            </span>
          </Link>
          <div className="flex items-center gap-4">
            {data ? (
              <p
                className="hidden items-center gap-2 text-[11px] text-ink-muted sm:flex"
                role="status"
              >
                <span aria-hidden="true" className="relative flex h-2 w-2">
                  <span className="live-ping absolute inline-flex h-full w-full rounded-full bg-state-up" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-state-up" />
                </span>
                Rechargement automatique
              </p>
            ) : null}
            <button
              onClick={() => setReportOpen(true)}
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-ink-soft hover:text-ink"
            >
              <MessageSquareWarning
                className="h-3.5 w-3.5"
                aria-hidden="true"
              />
              Signaler un problème
            </button>
            <Link
              href="/register"
              className="inline-flex items-center gap-1 text-xs font-semibold text-brand hover:text-brand-strong"
            >
              Ouvrir mon espace
              <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
            </Link>
          </div>
        </div>
      </header>
      {reportOpen && (
        <ReportIssueDialog
          statusSlug={slug}
          onClose={() => setReportOpen(false)}
        />
      )}

      <main className="mx-auto max-w-5xl space-y-5 px-5 py-8">
        {notFound ? (
          <div className="rounded-2xl border border-line bg-surface p-8 text-center">
            <h1 className="text-xl font-semibold text-ink">Page introuvable</h1>
            <p className="mt-2 text-sm text-ink-soft">
              Cette page de statut n'existe pas ou a été supprimée.
            </p>
          </div>
        ) : data === null ? (
          <>
            <Skeleton className="h-20 rounded-2xl" />
            <Skeleton className="h-24 rounded-2xl" />
            <Skeleton className="h-40 rounded-2xl" />
            <Skeleton className="h-72 rounded-2xl" />
          </>
        ) : (
          <>
            <Reveal>
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                  <h1 className="text-2xl font-semibold tracking-tight text-ink">
                    {data.title}
                  </h1>
                  {data.description ? (
                    <p className="mt-2 max-w-2xl text-sm leading-6 text-ink-soft">
                      {data.description}
                    </p>
                  ) : null}
                </div>
                <p className="metric text-[11px] text-ink-muted">
                  Dernière mesure affichée · {formatDateTime(data.generatedAt)}
                </p>
              </div>
            </Reveal>
            <Reveal delay={60}>
              <VerdictCard data={data} />
            </Reveal>
            {data.monitors.length > 0 ? (
              <>
                <Reveal delay={90}>
                  <ProblemList data={data} windowDays={data.days} />
                </Reveal>
                <Reveal delay={110}>
                  <SummaryStrip data={data} />
                </Reveal>
                <Reveal delay={130}>
                  <StatusLegend />
                </Reveal>
                <Reveal delay={150}>
                  <StatusMatrix data={data} />
                </Reveal>
                {data.monitors.map((monitor, index) => (
                  <Reveal key={monitor.id} delay={170 + index * 60}>
                    <ServiceAnalysis monitor={monitor} windowDays={data.days} />
                  </Reveal>
                ))}
                <Reveal delay={240}>
                  <IncidentTimeline data={data} />
                </Reveal>
                <Reveal delay={260}>
                  <MethodologyPanel data={data} />
                </Reveal>
              </>
            ) : null}
            {error ? (
              <p className="text-center text-xs text-state-warn">{error}</p>
            ) : null}
          </>
        )}
      </main>

      <footer className="border-t border-line bg-surface py-6">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-center gap-2 px-5 text-xs text-ink-muted">
          <Logo className="h-5 w-5" />
          <span>
            Opéré par{" "}
            <Link
              href="/"
              className="font-semibold text-brand hover:text-brand-strong"
            >
              UptimePulse
            </Link>
          </span>
          <span aria-hidden="true">·</span>
          <span>
            {data
              ? `${data.methodology.retentionDays} jours de checks conservés, purgés automatiquement`
              : "Historique conservé en continu"}
          </span>
        </div>
      </footer>
    </div>
  );
}
