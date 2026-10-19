import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { CheckClassification, PublicStatusData } from "@shared/contracts";
import { checkClassificationLabels } from "@shared/contracts";
import {
  CircleCheck,
  Clock,
  Gauge,
  Lock,
  Radar,
  TriangleAlert,
} from "lucide-react";

export type MonitorMetrics = PublicStatusData["monitors"][number];
export type StatusPayload = PublicStatusData;

const numberFr = new Intl.NumberFormat("fr-FR");
const dateTimeFr = new Intl.DateTimeFormat("fr-FR", {
  day: "2-digit",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});
const hourFr = new Intl.DateTimeFormat("fr-FR", {
  hour: "2-digit",
  minute: "2-digit",
});
const dayHourFr = new Intl.DateTimeFormat("fr-FR", {
  weekday: "short",
  hour: "2-digit",
});

/*
 * This module is only mounted on the light public analysis route, so the chart
 * gets literal light-mode colors: recharts paints SVG attributes and cannot
 * read a Tailwind utility.
 */
const CHART = {
  grid: "#dbe7f2",
  axis: "#5c7c96",
  line: "#0e7490",
  tooltipBg: "#ffffff",
  tooltipBorder: "#dbe7f2",
  tooltipLabel: "#33526a",
} as const;

export function formatMs(value: number | null): string {
  return value === null ? "—" : `${numberFr.format(value)} ms`;
}

export function formatPercent(value: number | null, digits = 2): string {
  return value === null ? "—" : `${value.toFixed(digits).replace(".", ",")} %`;
}

/** Compact human duration; never prints a unit the reader has to translate. */
export function formatDuration(seconds: number | null): string {
  if (seconds === null) return "—";
  const total = Math.max(0, Math.round(seconds));
  if (total < 60) return `${total} s`;
  const minutes = Math.floor(total / 60);
  if (minutes < 60)
    return `${minutes} min ${String(total % 60).padStart(2, "0")} s`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours} h ${String(minutes % 60).padStart(2, "0")}`;
  return `${Math.floor(hours / 24)} j ${hours % 24} h`;
}

export function formatDateTime(value: string | null): string {
  if (!value) return "—";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "—" : dateTimeFr.format(parsed);
}

function Card({
  title,
  icon,
  children,
  note,
}: {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
  note?: string;
}) {
  return (
    <section className="rounded-2xl border border-line bg-surface p-5 shadow-sm shadow-brand/5">
      <h3 className="flex items-center gap-2 text-sm font-semibold text-ink">
        <span className="text-brand" aria-hidden="true">
          {icon}
        </span>
        {title}
      </h3>
      {note ? (
        <p className="mt-1 text-[11px] leading-4 text-ink-muted">{note}</p>
      ) : null}
      <div className="mt-4">{children}</div>
    </section>
  );
}

function Metric({
  label,
  value,
  hint,
  tone = "default",
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "default" | "good" | "warn" | "bad";
}) {
  const toneClass =
    tone === "good"
      ? "text-state-up"
      : tone === "warn"
        ? "text-state-warn"
        : tone === "bad"
          ? "text-state-down"
          : "text-ink";
  return (
    <div>
      <p className={`metric text-lg font-semibold ${toneClass}`}>{value}</p>
      <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-muted">
        {label}
      </p>
      {hint ? (
        <p className="mt-0.5 text-[11px] text-ink-muted">{hint}</p>
      ) : null}
    </div>
  );
}

/**
 * Availability for the four rolling windows. The bar is drawn on a 0–100 scale
 * with the 99,9 % objective marked, so a 83 % service is not visually flattened
 * next to a 99 % one.
 */
export function AvailabilityWindows({ monitor }: { monitor: MonitorMetrics }) {
  const entries = [
    { key: "24 h", window: monitor.windows.d1 },
    { key: "7 j", window: monitor.windows.d7 },
    { key: "30 j", window: monitor.windows.d30 },
    { key: `${monitor.sla.windowDays} j`, window: monitor.windows.d90 },
  ];
  return (
    <Card
      title="Disponibilité"
      icon={<Gauge className="h-4 w-4" />}
      note={`Pourcentage de checks en succès sur des fenêtres glissantes. Objectif de référence : ${monitor.sla.targetPercent.toString().replace(".", ",")} %.`}
    >
      <ul className="space-y-3">
        {entries.map(entry => {
          const percent = entry.window.uptimePercent;
          return (
            <li key={entry.key}>
              <div className="flex items-baseline justify-between text-xs">
                <span className="text-ink-soft">{entry.key}</span>
                <span className="metric text-ink">
                  {formatPercent(percent)}
                  <span className="ml-2 text-[10px] text-ink-muted">
                    {entry.window.totalChecks === 0
                      ? "aucun check"
                      : `${entry.window.totalChecks - entry.window.failedChecks}/${entry.window.totalChecks} checks`}
                  </span>
                </span>
              </div>
              <div
                className="relative mt-1 h-1.5 overflow-hidden rounded-full bg-surface-2"
                role="img"
                aria-label={`${entry.key} : ${formatPercent(percent)} de disponibilité sur ${entry.window.totalChecks} checks`}
              >
                <span
                  className={`h-full rounded-full ${
                    percent === null
                      ? "bg-ink-muted/40"
                      : percent >= monitor.sla.targetPercent
                        ? "bg-state-up"
                        : percent >= 95
                          ? "bg-state-warn"
                          : "bg-state-down"
                  }`}
                  style={{ width: `${percent ?? 0}%` }}
                />
                <span
                  className="absolute top-0 h-full w-px bg-brand"
                  style={{ left: `${monitor.sla.targetPercent}%` }}
                  aria-hidden="true"
                />
              </div>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

/** Hourly means keep the true gap: an hour without a check draws nothing. */
export function LatencyChart({ monitor }: { monitor: MonitorMetrics }) {
  const points = monitor.hourly
    .filter(hour => hour.averageMs !== null)
    .map(hour => ({
      label: dayHourFr.format(new Date(hour.time)),
      full: dateTimeFr.format(new Date(hour.time)),
      averageMs: hour.averageMs as number,
      samples: hour.samples,
    }));

  if (points.length < 2) {
    return (
      <Card
        title="Latence moyenne par heure"
        icon={<Clock className="h-4 w-4" />}
        note="Au moins deux heures de checks sont nécessaires pour tracer la courbe."
      >
        <p className="text-xs text-ink-muted">
          {points.length === 0
            ? "Aucun check mesuré sur les 7 derniers jours."
            : "Une seule heure de données : la courbe s’affichera au prochain check."}
        </p>
      </Card>
    );
  }

  return (
    <Card
      title="Latence moyenne par heure"
      icon={<Clock className="h-4 w-4" />}
      note={`Moyenne horaire des checks en succès sur ${monitor.latency.windowDays} jours (${points.length} heures renseignées).`}
    >
      <div className="h-40 w-full" aria-hidden="true">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={points}>
            <CartesianGrid
              stroke={CHART.grid}
              strokeDasharray="3 3"
              vertical={false}
            />
            <XAxis
              dataKey="label"
              tick={{ fill: CHART.axis, fontSize: 10 }}
              axisLine={false}
              tickLine={false}
              minTickGap={40}
            />
            <YAxis
              tick={{ fill: CHART.axis, fontSize: 10 }}
              axisLine={false}
              tickLine={false}
              width={48}
              unit=" ms"
            />
            <Tooltip
              contentStyle={{
                background: CHART.tooltipBg,
                border: `1px solid ${CHART.tooltipBorder}`,
                borderRadius: 12,
                fontSize: 12,
                boxShadow: "0 12px 28px rgba(10, 34, 51, 0.12)",
              }}
              labelStyle={{ color: CHART.tooltipLabel }}
              itemStyle={{ color: CHART.line }}
              formatter={(value: number | string) => [
                `${numberFr.format(Number(value))} ms`,
                "moyenne",
              ]}
            />
            <Line
              type="monotone"
              dataKey="averageMs"
              stroke={CHART.line}
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4 }}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <p className="sr-only">
        Latence moyenne horaire&nbsp;:{" "}
        {points
          .slice(-6)
          .map(point => `${point.full} — ${point.averageMs} ms`)
          .join("; ")}
        .
      </p>
    </Card>
  );
}

/**
 * Percentiles are exact on the sampled checks. Under 10 samples the numbers are
 * real but statistically meaningless, so the card says so instead of hiding it.
 */
export function LatencyDistribution({ monitor }: { monitor: MonitorMetrics }) {
  const { latency } = monitor;
  const lowSample = latency.sampleChecks < 10;
  const trend =
    latency.trendPercent === null
      ? null
      : Math.abs(latency.trendPercent) < 2
        ? { label: "stable", tone: "default" as const }
        : latency.trendPercent > 0
          ? {
              label: `+${latency.trendPercent.toFixed(1).replace(".", ",")} % vs 7 j précédent`,
              tone: "bad" as const,
            }
          : {
              label: `${latency.trendPercent.toFixed(1).replace(".", ",")} % vs 7 j précédent`,
              tone: "good" as const,
            };
  return (
    <Card
      title="Temps de réponse"
      icon={<Radar className="h-4 w-4" />}
      note={`Percentiles exacts sur ${latency.sampleChecks} check(s) en succès des ${latency.windowDays} derniers jours.${
        lowSample ? " Échantillon court : à interpréter avec prudence." : ""
      }`}
    >
      <div className="grid grid-cols-3 gap-4 sm:grid-cols-5">
        <Metric label="moyenne" value={formatMs(latency.averageMs)} />
        <Metric label="p50" value={formatMs(latency.p50Ms)} />
        <Metric label="p90" value={formatMs(latency.p90Ms)} />
        <Metric label="p95" value={formatMs(latency.p95Ms)} />
        <Metric label="max" value={formatMs(latency.maxMs)} />
      </div>
      {trend ? (
        <p
          className={`mt-3 text-xs ${
            trend.tone === "bad"
              ? "text-state-warn"
              : trend.tone === "good"
                ? "text-state-up"
                : "text-ink-soft"
          }`}
        >
          Tendance : {trend.label}
        </p>
      ) : null}
    </Card>
  );
}

const PHASE_SEGMENTS = [
  { key: "dnsMs", label: "DNS", className: "bg-cyan-500" },
  { key: "tcpMs", label: "TCP", className: "bg-sky-600" },
  { key: "tlsMs", label: "TLS", className: "bg-indigo-500" },
  { key: "serverMs", label: "Serveur", className: "bg-emerald-500" },
] as const;

/**
 * The four measured phases add up to TTFB. Rendering them as one bar makes the
 * share of each hop obvious, which is the question an operator actually asks.
 */
export function PhaseBreakdown({ monitor }: { monitor: MonitorMetrics }) {
  const { phases } = monitor;
  const segments = PHASE_SEGMENTS.map(segment => ({
    ...segment,
    value: phases[segment.key] ?? 0,
  }));
  const total = segments.reduce((sum, segment) => sum + segment.value, 0);

  if (total === 0) {
    return (
      <Card
        title="Décomposition de la latence"
        icon={<Gauge className="h-4 w-4" />}
        note="Résolution DNS, connexion TCP, handshake TLS, puis temps passé par le serveur."
      >
        <p className="text-xs text-ink-muted">
          Pas encore de phases mesurées : les checks HTTPS récents sont
          nécessaires.
        </p>
      </Card>
    );
  }

  return (
    <Card
      title="Décomposition de la latence"
      icon={<Gauge className="h-4 w-4" />}
      note={`Moyennes sur ${phases.sampleChecks} check(s) — total ${formatMs(phases.ttfbMs)} jusqu’au premier octet.`}
    >
      <div
        className="flex h-3 w-full overflow-hidden rounded-full"
        role="img"
        aria-label={`Latence moyenne : ${segments
          .map(segment => `${segment.label} ${segment.value} ms`)
          .join(", ")}`}
      >
        {segments.map(segment =>
          segment.value === 0 ? null : (
            <span
              key={segment.key}
              className={segment.className}
              style={{ width: `${(segment.value / total) * 100}%` }}
              title={`${segment.label} — ${formatMs(segment.value)}`}
            />
          )
        )}
      </div>
      <ul className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-xs sm:grid-cols-4">
        {segments.map(segment => (
          <li key={segment.key} className="flex items-center gap-2">
            <span
              className={`h-2.5 w-2.5 rounded-sm ${segment.className}`}
              aria-hidden="true"
            />
            <span className="text-ink-soft">{segment.label}</span>
            <span className="metric ml-auto text-ink">
              {formatMs(segment.value === 0 ? null : segment.value)}
            </span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

/**
 * Shared with every other surface that shows an outcome, so a new
 * classification cannot be missing from one list and present in another.
 */
const CLASSIFICATION_LABELS: Record<CheckClassification, string> =
  checkClassificationLabels;

export function FailureCauses({ monitor }: { monitor: MonitorMetrics }) {
  const total = monitor.failures.reduce(
    (sum, failure) => sum + failure.count,
    0
  );
  return (
    <Card
      title="Causes d’échec relevées"
      icon={<TriangleAlert className="h-4 w-4" />}
      note={`Répartition des ${total} check(s) en échec sur ${monitor.incidents.windowDays} jours. Une erreur isolée ne devient un incident qu’après trois échecs consécutifs.`}
    >
      {monitor.failures.length === 0 ? (
        <p className="flex items-center gap-2 text-xs text-state-up">
          <CircleCheck className="h-4 w-4" aria-hidden="true" />
          Aucun échec enregistré sur la période.
        </p>
      ) : (
        <ul className="space-y-2 text-xs">
          {monitor.failures.map(failure => (
            <li
              key={failure.classification}
              className="flex items-center gap-3"
            >
              <span className="w-32 shrink-0 text-ink-soft">
                {CLASSIFICATION_LABELS[failure.classification] ??
                  failure.classification}
              </span>
              <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-2">
                <span
                  className="block h-full rounded-full bg-state-down"
                  style={{
                    width: `${total === 0 ? 0 : (failure.count / total) * 100}%`,
                  }}
                />
              </span>
              <span className="metric w-8 shrink-0 text-right text-ink-soft">
                {failure.count}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

export function IncidentStats({ monitor }: { monitor: MonitorMetrics }) {
  const stats = monitor.incidents;
  return (
    <Card
      title="Incidents et réparation"
      icon={<Radar className="h-4 w-4" />}
      note={`Sur ${stats.windowDays} jours. MTTR = durée moyenne des incidents résolus.`}
    >
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Metric
          label="incidents"
          value={String(stats.confirmedCount)}
          tone={stats.confirmedCount === 0 ? "good" : "warn"}
        />
        <Metric
          label="downtime total"
          value={formatDuration(stats.totalDowntimeSeconds)}
        />
        <Metric label="mttr" value={formatDuration(stats.averageDownSeconds)} />
        <Metric
          label="plus long"
          value={formatDuration(stats.longestDownSeconds)}
        />
      </div>
      <p className="mt-3 text-[11px] text-ink-muted">
        Dernier incident&nbsp;:{" "}
        {stats.lastIncidentAt ? formatDateTime(stats.lastIncidentAt) : "aucun"}
      </p>
    </Card>
  );
}

export function CertificateCard({ monitor }: { monitor: MonitorMetrics }) {
  const certificate = monitor.certificate;
  if (!certificate) {
    return (
      <Card
        title="Certificat TLS"
        icon={<Lock className="h-4 w-4" />}
        note="Lu sur la connexion du dernier check HTTPS réussi."
      >
        <p className="text-xs text-ink-muted">
          Aucun certificat&nbsp;: cette cible n’est pas servie en HTTPS, ou
          aucun check HTTPS n’a encore réussi.
        </p>
      </Card>
    );
  }
  const days = certificate.daysRemaining;
  const tone =
    days < 0 ? "bad" : days <= 14 ? "bad" : days <= 30 ? "warn" : "good";
  return (
    <Card
      title="Certificat TLS"
      icon={<Lock className="h-4 w-4" />}
      note="Expiration surveillée à chaque check HTTPS."
    >
      <div className="flex flex-wrap items-baseline gap-4">
        <Metric
          label={days < 0 ? "expiré depuis" : "jours restants"}
          value={`${Math.abs(days)}`}
          tone={tone}
        />
        <div className="text-xs text-ink-soft">
          <p>
            Échéance&nbsp;
            <span className="text-ink">
              {formatDateTime(certificate.validTo)}
            </span>
          </p>
          <p
            className="mt-1 truncate text-ink-muted"
            title={certificate.subject}
          >
            Sujet&nbsp;{certificate.subject}
          </p>
          <p
            className="mt-1 truncate text-ink-muted"
            title={certificate.issuer}
          >
            Émetteur&nbsp;{certificate.issuer}
          </p>
        </div>
      </div>
    </Card>
  );
}

export function CoverageCard({ monitor }: { monitor: MonitorMetrics }) {
  const coverage = monitor.coverage;
  return (
    <Card
      title="Comment ce service est surveillé"
      icon={<Radar className="h-4 w-4" />}
      note="La cadence et le timeout configurés — pas une promesse marketing."
    >
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-xs">
        <div>
          <dt className="text-ink-muted">Intervalle</dt>
          <dd className="metric text-ink">
            {coverage.intervalSeconds >= 60
              ? `${Math.round(coverage.intervalSeconds / 60)} min`
              : `${coverage.intervalSeconds} s`}
          </dd>
        </div>
        <div>
          <dt className="text-ink-muted">Timeout</dt>
          <dd className="metric text-ink">
            {(coverage.timeoutMs / 1000).toFixed(1).replace(".", ",")} s
          </dd>
        </div>
        <div>
          <dt className="text-ink-muted">
            Checks sur {monitor.sla.windowDays} j
          </dt>
          <dd className="metric text-ink">
            {numberFr.format(coverage.totalChecks)}
          </dd>
        </div>
        <div>
          <dt className="text-ink-muted">Dernier check</dt>
          <dd className="text-ink">{formatDateTime(coverage.lastCheckAt)}</dd>
        </div>
        <div className="col-span-2">
          <dt className="text-ink-muted">Prochain check</dt>
          <dd className="text-ink">
            {coverage.nextCheckAt
              ? formatDateTime(coverage.nextCheckAt)
              : "suspendu"}
          </dd>
        </div>
      </dl>
      {monitor.sla.errorBudgetMinutes !== null ? (
        <p className="mt-3 border-t border-line pt-3 text-[11px] text-ink-muted">
          Budget d’erreur restant à{" "}
          {monitor.sla.targetPercent.toString().replace(".", ",")} % sur{" "}
          {monitor.sla.windowDays} j&nbsp;:{" "}
          <span className="text-ink-soft">
            {formatDuration(monitor.sla.errorBudgetMinutes * 60)}
          </span>
          , {formatDuration((monitor.sla.consumedMinutes ?? 0) * 60)} déjà
          consommées.
        </p>
      ) : null}
    </Card>
  );
}

/** Twenty-four hourly cells: the short-term rhythm the daily calendar hides. */
export function HourlyStrip({ monitor }: { monitor: MonitorMetrics }) {
  const hours = monitor.hourly.slice(-24);
  return (
    <div
      className="flex h-6 items-stretch gap-[2px]"
      role="img"
      aria-label={`Heures des dernières 24 heures pour ${monitor.name}`}
    >
      {hours.map(hour => {
        const hasData = hour.samples > 0;
        const color = !hasData
          ? "bg-surface-2"
          : hour.down === 0
            ? "bg-state-up"
            : hour.up === 0
              ? "bg-state-down"
              : "bg-state-warn";
        return (
          <span
            key={hour.time}
            title={`${hourFr.format(new Date(hour.time))} — ${
              hasData
                ? `${hour.up} en ligne, ${hour.down} en échec`
                : "aucun check"
            }`}
            className={`min-w-0 flex-1 rounded-sm ${color}`}
          />
        );
      })}
    </div>
  );
}

export function SummaryStrip({ data }: { data: StatusPayload }) {
  const summary = data.summary;
  const items = [
    {
      label: "services supervisés",
      value: `${summary.services}${
        summary.pausedServices > 0
          ? ` (${summary.pausedServices} en pause)`
          : ""
      }`,
    },
    {
      label: `disponibilité ${data.methodology.windowDays} j · ${numberFr.format(
        data.monitors.reduce(
          (total, monitor) => total + monitor.coverage.totalChecks,
          0
        )
      )} checks`,
      value: formatPercent(summary.globalUptimePercent),
    },
    { label: "checks sur 24 h", value: numberFr.format(summary.checks24h) },
    {
      label: "latence médiane",
      value: formatMs(summary.globalMedianLatencyMs),
    },
    {
      label: `incidents ${data.methodology.windowDays} j`,
      value: `${summary.incidents90d}${
        summary.activeIncidents > 0
          ? ` · ${summary.activeIncidents} en cours`
          : ""
      }`,
    },
    {
      label: "downtime cumulé",
      value: formatDuration(summary.downtime90dSeconds),
    },
  ];
  return (
    <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
      {items.map(item => (
        <div
          key={item.label}
          className="rounded-xl border border-line bg-page px-4 py-3"
        >
          <dd className="metric text-base font-semibold text-ink">
            {item.value}
          </dd>
          <dt className="mt-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-muted">
            {item.label}
          </dt>
        </div>
      ))}
    </dl>
  );
}

/**
 * Chronology of everything the retention window can prove, open incidents first
 * because they are the only rows that still need an operator.
 */
export function IncidentTimeline({ data }: { data: StatusPayload }) {
  const incidents = [...data.incidents].sort((a, b) => {
    const aOpen = a.status === "confirmed" && !a.resolvedAt ? 0 : 1;
    const bOpen = b.status === "confirmed" && !b.resolvedAt ? 0 : 1;
    if (aOpen !== bOpen) return aOpen - bOpen;
    return new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime();
  });

  return (
    <section className="rounded-2xl border border-line bg-surface p-5 shadow-sm shadow-brand/5">
      <h2 className="flex items-center gap-2 text-sm font-semibold text-ink">
        <Radar className="h-4 w-4 text-brand" aria-hidden="true" />
        Chronologie des incidents ({data.methodology.windowDays} j)
      </h2>
      <p className="mt-1 text-[11px] text-ink-muted">
        Horodatage de départ, confirmation, rétablissement et durée réelle —{" "}
        {incidents.length} incident{incidents.length === 1 ? "" : "s"} retenu
        {incidents.length === 1 ? "" : "s"}.
      </p>
      {incidents.length === 0 ? (
        <p className="mt-4 flex items-center gap-2 text-xs text-state-up">
          <CircleCheck className="h-4 w-4" aria-hidden="true" />
          Aucun incident confirmé sur la période.
        </p>
      ) : (
        <ol className="mt-4 space-y-4 border-l border-line pl-4">
          {incidents.map(incident => {
            const open =
              incident.status === "confirmed" && !incident.resolvedAt;
            return (
              <li key={incident.id} className="relative text-xs">
                <span
                  className={`absolute -left-[21px] top-1 h-2.5 w-2.5 rounded-full ${
                    open ? "bg-state-down" : "bg-ink-muted/50"
                  }`}
                  aria-hidden="true"
                />
                <p className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold text-ink">
                    {incident.monitorName}
                  </span>
                  <span
                    className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                      open
                        ? "border-state-down/30 bg-state-down/10 text-state-down"
                        : "border-line bg-page text-ink-muted"
                    }`}
                  >
                    {open ? "en cours" : "rétabli"}
                  </span>
                  <span className="text-ink-muted">
                    {formatDateTime(incident.startedAt)}
                  </span>
                </p>
                <p className="mt-1 text-ink-soft">
                  {open
                    ? `Durée actuelle ${formatDuration(incident.elapsedSeconds)}`
                    : `Durée ${formatDuration(incident.durationSeconds)}`}
                  {incident.confirmedAt
                    ? ` · confirmé le ${formatDateTime(incident.confirmedAt)}`
                    : ""}
                  {incident.resolvedAt
                    ? ` · rétabli le ${formatDateTime(incident.resolvedAt)}`
                    : ""}
                </p>
                {incident.reason ? (
                  <p className="mt-1 text-ink-muted">
                    Motif relevé&nbsp;: {incident.reason}
                  </p>
                ) : null}
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}

/**
 * Everything needed to recompute the numbers by hand. A public status page is a
 * claim, so the page publishes its own methodology next to the figures.
 */
export function MethodologyPanel({ data }: { data: StatusPayload }) {
  const methodology = data.methodology;
  return (
    <details className="rounded-2xl border border-line bg-surface p-5 text-sm shadow-sm shadow-brand/5">
      <summary className="cursor-pointer list-none font-semibold text-ink">
        Méthodologie — comment ces chiffres sont produits
      </summary>
      <div className="mt-4 space-y-3 text-xs leading-5 text-ink-soft">
        <p>
          <span className="text-ink">Confirmation d’un incident</span> : un
          check en échec isolé n’est pas un incident.{" "}
          {methodology.failureThreshold} échecs consécutifs le confirment et
          déclenchent l’alerte&nbsp;; {methodology.recoveryThreshold} succès
          consécutifs le referment.
        </p>
        <p>
          <span className="text-ink">Mesure</span> : chaque check résout le nom,
          vérifie que l’adresse publique est autorisée (les réseaux privés et
          les adresses réservées sont refusés), établit une connexion neuve,
          puis mesure séparément DNS, TCP, TLS et le délai jusqu’au premier
          octet. Le temps attribué au serveur est « TTFB − DNS − TCP − TLS ».
        </p>
        <p>
          <span className="text-ink">Fenêtres</span> : disponibilité sur 24 h, 7
          j, 30 j et {methodology.windowDays} j en glissant ; latence et phases
          sur les {methodology.latencySampleWindowDays} derniers jours,
          échantillon borné à {numberFr.format(methodology.latencySampleCap)}{" "}
          checks par service. Les percentiles sont exacts sur cet échantillon.
        </p>
        <p>
          <span className="text-ink">Rétention</span> :{" "}
          {methodology.retentionDays} jours de checks bruts, puis purge
          automatique. Un calendrier gris sans check signifie « pas encore de
          données », jamais « panne ».
        </p>
        <p>
          <span className="text-ink">Objectif 99,9 %</span> : repère de lecture,
          pas un contrat. Le budget d’erreur est calculé à partir des checks
          réellement mesurés.
        </p>
        <p>
          <span className="text-ink">Fraîcheur</span> : cette page est régénérée
          toutes les 30 secondes côté serveur et recharge automatiquement. Les
          heures affichées sont celles de votre fuseau.
        </p>
      </div>
    </details>
  );
}
