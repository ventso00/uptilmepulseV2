import { z } from "zod";

export const emailSchema = z.string().trim().toLowerCase().email().max(320);
export const passwordSchema = z.string().min(12).max(128);
export const monitorNameSchema = z.string().trim().min(1).max(120);
export const monitorKeywordModeValues = [
  "must_contain",
  "must_not_contain",
] as const;
export const monitorKeywordModeSchema = z.enum(monitorKeywordModeValues);
export type MonitorKeywordMode = (typeof monitorKeywordModeValues)[number];
export const intervalSecondsSchema = z.number().int().min(300).max(86_400);
export const timeoutMsSchema = z.number().int().min(1_000).max(30_000);

export const registerSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
});

export const loginSchema = registerSchema;

export const changePasswordSchema = z.object({
  currentPassword: passwordSchema,
  newPassword: passwordSchema,
});

export const monitorCreateSchema = z.object({
  name: monitorNameSchema,
  url: z.string().trim().min(1).max(2048),
  intervalSeconds: intervalSecondsSchema.default(300),
  timeoutMs: timeoutMsSchema.default(10_000),
  keyword: z.string().min(1).max(160).nullish(),
  keywordMode: monitorKeywordModeSchema.default("must_contain"),
});

/**
 * Update payload: every field is optional and, unlike `partial()` of the create
 * schema, carries no defaults. Zod 4 re-applies a default when a key is absent,
 * so `monitorCreateSchema.partial()` would silently reset intervalSeconds,
 * timeoutMs and keywordMode on a PUT that only renames a monitor.
 */
export const monitorUpdateSchema = z.object({
  name: monitorNameSchema.optional(),
  url: z.string().trim().min(1).max(2048).optional(),
  intervalSeconds: intervalSecondsSchema.optional(),
  timeoutMs: timeoutMsSchema.optional(),
  keyword: z.string().min(1).max(160).nullish(),
  keywordMode: monitorKeywordModeSchema.optional(),
});

export const periodSchema = z.enum(["24h", "7d", "30d"]).default("24h");
export const periodOptions = ["24h", "7d", "30d"] as const;
export const periodLabels: Record<(typeof periodOptions)[number], string> = {
  "24h": "24 heures",
  "7d": "7 jours",
  "30d": "30 jours",
};

/**
 * Single source of truth for plan limits. The client reads these to render
 * quota copy so the UI can never drift from the server-side enforcement.
 */
export const FREE_PLAN = {
  maxMonitors: 3,
  minIntervalSeconds: 300,
  maxTimeoutMs: 30_000,
} as const;

/** Incident confirmation thresholds, shared with the UI copy. */
export const INCIDENT_RULES = {
  failureThreshold: 3,
  recoveryThreshold: 2,
} as const;

export const monitorStatusSchema = z.enum(["UNKNOWN", "UP", "DOWN", "PAUSED"]);
export type MonitorStatus = z.infer<typeof monitorStatusSchema>;

export const checkClassificationValues = [
  "UP_HTTP_2XX",
  "UP_HTTP_3XX",
  "DOWN_HTTP_4XX",
  "DOWN_HTTP_5XX",
  "DOWN_TIMEOUT",
  "DOWN_DNS",
  "DOWN_TLS",
  "DOWN_NETWORK",
  "INVALID_TARGET",
  "BLOCKED_TARGET",
  "DOWN_KEYWORD_MISSING",
  "DOWN_KEYWORD_PRESENT",
] as const;
export const checkClassificationSchema = z.enum(checkClassificationValues);

/** French wording for a check outcome, shared by every surface that shows one. */
export const checkClassificationLabels: Record<
  (typeof checkClassificationValues)[number],
  string
> = {
  UP_HTTP_2XX: "Succès 2xx",
  UP_HTTP_3XX: "Redirection",
  DOWN_HTTP_4XX: "Erreur 4xx",
  DOWN_HTTP_5XX: "Erreur 5xx",
  DOWN_TIMEOUT: "Délai dépassé",
  DOWN_DNS: "Résolution DNS",
  DOWN_TLS: "Handshake TLS",
  DOWN_NETWORK: "Réseau",
  INVALID_TARGET: "Cible invalide",
  BLOCKED_TARGET: "Cible bloquée",
  DOWN_KEYWORD_MISSING: "Contenu attendu absent",
  DOWN_KEYWORD_PRESENT: "Contenu interdit présent",
};

export const monitorKeywordModeLabels: Record<MonitorKeywordMode, string> = {
  must_contain: "doit contenir",
  must_not_contain: "ne doit pas contenir",
};

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type MonitorCreateInput = z.infer<typeof monitorCreateSchema>;
export type MonitorUpdateInput = z.infer<typeof monitorUpdateSchema>;
export type CheckClassification = z.infer<typeof checkClassificationSchema>;

export const API_ERROR_CODES = {
  UNAUTHORIZED: "UNAUTHORIZED",
  FORBIDDEN: "FORBIDDEN",
  /** The application belongs to one creator account; see `server/auth/owner.ts`. */
  ACCESS_RESERVED: "ACCESS_RESERVED",
  REGISTRATION_CLOSED: "REGISTRATION_CLOSED",
  VALIDATION_ERROR: "VALIDATION_ERROR",
  QUOTA_EXCEEDED: "QUOTA_EXCEEDED",
  FEATURE_UNAVAILABLE: "FEATURE_UNAVAILABLE",
  INVALID_TARGET: "INVALID_TARGET",
  BLOCKED_TARGET: "BLOCKED_TARGET",
  NOT_FOUND: "NOT_FOUND",
  RATE_LIMITED: "RATE_LIMITED",
  CONFLICT: "CONFLICT",
} as const;

/* -------------------------------------------------------------------------- */
/* Response contracts                                                          */
/*                                                                             */
/* The client parses every response with these schemas, so a server-side shape */
/* change surfaces as a typed error instead of a silent `undefined` at render.  */
/* -------------------------------------------------------------------------- */

const dateString = z
  .union([z.string(), z.date()])
  .transform(value => (value instanceof Date ? value.toISOString() : value));

export const userSchema = z.object({
  id: z.number(),
  email: z.string().nullable(),
  name: z.string().nullable(),
  /** Drives the creator-console entry point; the server is the only writer. */
  role: z.enum(["user", "admin"]).default("user"),
});
export type User = z.infer<typeof userSchema>;
export const authUserResponseSchema = z.object({ user: userSchema });

export const latestCheckSchema = z.object({
  statusCode: z.number().nullable(),
  responseTimeMs: z.number().nullable(),
  dnsMs: z.number().nullable().default(null),
  tcpMs: z.number().nullable().default(null),
  tlsMs: z.number().nullable().default(null),
  ttfbMs: z.number().nullable().default(null),
  isUp: z.boolean(),
  classification: checkClassificationSchema,
  checkedAt: dateString,
});

/** TLS certificate seen on the monitor's last successful HTTPS check. */
export const sslCertificateSchema = z.object({
  issuer: z.string(),
  subject: z.string(),
  validTo: dateString.nullable(),
});
export type SslCertificate = z.infer<typeof sslCertificateSchema>;

/** Compact per-check dot for the dashboard uptime strip (oldest first). */
export const recentCheckSchema = z.object({
  isUp: z.boolean(),
  statusCode: z.number().nullable(),
  responseTimeMs: z.number().nullable(),
  checkedAt: dateString,
});

export const monitorSchema = z.object({
  id: z.number(),
  name: z.string(),
  url: z.string(),
  intervalSeconds: z.number(),
  timeoutMs: z.number(),
  keyword: z.string().nullable().default(null),
  keywordMode: monitorKeywordModeSchema.default("must_contain"),
  enabled: z.boolean(),
  status: monitorStatusSchema,
  consecutiveFailures: z.number(),
  consecutiveSuccesses: z.number(),
  uptimePercent: z.number().nullable(),
  averageResponseTimeMs: z.number().nullable(),
  lastCheckAt: dateString.nullable(),
  nextCheckAt: dateString,
  latestCheck: latestCheckSchema.nullable(),
  recentChecks: z.array(recentCheckSchema).default([]),
  ssl: z
    .object({
      issuer: z.string(),
      subject: z.string(),
      validTo: dateString.nullable(),
    })
    .nullable()
    .default(null),
});
export type Monitor = z.infer<typeof monitorSchema>;
export const monitorResponseSchema = z.object({ monitor: monitorSchema });
export const monitorListResponseSchema = z.object({
  monitors: z.array(monitorSchema),
});

export const manualCheckResultSchema = z.object({
  isUp: z.boolean(),
  statusCode: z.number().nullable(),
  responseTimeMs: z.number().nullable(),
  dnsMs: z.number().nullable().default(null),
  ttfbMs: z.number().nullable().default(null),
  classification: checkClassificationSchema,
  incidentAction: z.enum(["none", "failure", "recovery"]),
});
export type ManualCheckResult = z.infer<typeof manualCheckResultSchema>;
export const monitorCheckResponseSchema = z.object({
  check: manualCheckResultSchema.nullable(),
});

export const dashboardSummarySchema = z.object({
  totalMonitors: z.number(),
  upMonitors: z.number(),
  downMonitors: z.number(),
  pausedMonitors: z.number(),
  uptimePercent: z.number().nullable(),
  activeIncidents: z.number(),
  averageResponseTimeMs: z.number().nullable(),
});

export const dashboardIncidentSchema = z.object({
  id: z.number(),
  monitorId: z.number(),
  monitorName: z.string(),
  monitorUrl: z.string(),
  startedAt: dateString,
  confirmedAt: dateString.nullable(),
  reason: z.string().nullable(),
});

export const dashboardResponseSchema = z.object({
  summary: dashboardSummarySchema,
  monitors: z.array(monitorSchema),
  incidents: z.array(dashboardIncidentSchema),
});
export type DashboardData = z.infer<typeof dashboardResponseSchema>;

export const historyLogSchema = z.object({
  id: z.number(),
  statusCode: z.number().nullable(),
  responseTimeMs: z.number().nullable(),
  dnsMs: z.number().nullable().default(null),
  tcpMs: z.number().nullable().default(null),
  tlsMs: z.number().nullable().default(null),
  ttfbMs: z.number().nullable().default(null),
  isUp: z.boolean(),
  classification: checkClassificationSchema,
  errorMessage: z.string().nullable(),
  checkedAt: dateString,
});
export type HistoryLog = z.infer<typeof historyLogSchema>;

export const incidentStatusSchema = z.enum([
  "suspect",
  "confirmed",
  "resolved",
]);

export const monitorIncidentSchema = z.object({
  id: z.number(),
  monitorId: z.number(),
  startedAt: dateString,
  confirmedAt: dateString.nullable(),
  resolvedAt: dateString.nullable(),
  durationSeconds: z.number().nullable(),
  status: incidentStatusSchema,
  reason: z.string().nullable(),
});
export type MonitorIncident = z.infer<typeof monitorIncidentSchema>;

export const historyResponseSchema = z.object({
  logs: z.array(historyLogSchema),
  total: z.number(),
  hasMore: z.boolean(),
});
export const incidentsResponseSchema = z.object({
  incidents: z.array(monitorIncidentSchema),
});

export const notificationChannelSchema = z.object({
  id: z.number(),
  type: z.enum(["telegram"]),
  enabled: z.boolean(),
  createdAt: dateString,
  updatedAt: dateString,
});
export type NotificationChannel = z.infer<typeof notificationChannelSchema>;
export const channelsResponseSchema = z.object({
  channels: z.array(notificationChannelSchema),
});

/* -------------------------------------------------------------------------- */
/* Public status pages                                                         */
/* -------------------------------------------------------------------------- */

/**
 * Slug used in `/status/:slug`. Lowercase alphanumerics with inner hyphens,
 * 2–64 chars: keeps URLs shareable and blocks path tricks like "." or "..".
 */
export const statusPageSlugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(
    /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])$|^[a-z0-9]$/,
    "Identifiant uniquement en minuscules, chiffres et tirets"
  );

export const statusPageUpsertSchema = z.object({
  slug: statusPageSlugSchema,
  title: monitorNameSchema,
  description: z.string().trim().max(500).nullable().default(null),
});
export type StatusPageUpsertInput = z.infer<typeof statusPageUpsertSchema>;

export const statusPageSchema = z.object({
  id: z.number(),
  slug: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  createdAt: dateString,
});
export type StatusPage = z.infer<typeof statusPageSchema>;
export const statusPageResponseSchema = z.object({
  statusPage: statusPageSchema.nullable(),
});

/** One calendar day of checks; a day with no checks is omitted. */
export const statusDaySchema = z.object({
  date: z.string(),
  up: z.number(),
  down: z.number(),
});
export type StatusDay = z.infer<typeof statusDaySchema>;

/**
 * Availability over a rolling window, counted in checks rather than seconds:
 * the cadence is per-monitor, so a check ratio is what the operator can verify.
 */
export const statusWindowSchema = z.object({
  uptimePercent: z.number().nullable(),
  totalChecks: z.number(),
  failedChecks: z.number(),
});
export type StatusWindow = z.infer<typeof statusWindowSchema>;

/** One UTC hour of checks, oldest first. Drives the 24 h strip and the latency curve. */
export const statusHourSchema = z.object({
  time: dateString,
  up: z.number(),
  down: z.number(),
  /** Mean response time over the hour's successful checks; null when none had a timing. */
  averageMs: z.number().nullable(),
  samples: z.number(),
});
export type StatusHour = z.infer<typeof statusHourSchema>;

/**
 * Response-time distribution. Percentiles are exact over the sampled window
 * (bounded, see server/statuspages/analysis.ts) — `sampleChecks` tells the UI
 * when the sample is too small to be presented as a stable figure.
 */
export const statusLatencySchema = z.object({
  windowDays: z.number(),
  sampleChecks: z.number(),
  averageMs: z.number().nullable(),
  p50Ms: z.number().nullable(),
  p90Ms: z.number().nullable(),
  p95Ms: z.number().nullable(),
  maxMs: z.number().nullable(),
  /** Mean of the immediately preceding window, for the trend arrow. */
  previousAverageMs: z.number().nullable(),
  /** Signed change vs the previous window, in percent; null without two samples. */
  trendPercent: z.number().nullable(),
});
export type StatusLatency = z.infer<typeof statusLatencySchema>;

/** Mean of each measured phase. `serverMs` is derived: ttfb − dns − tcp − tls. */
export const statusPhasesSchema = z.object({
  windowDays: z.number(),
  sampleChecks: z.number(),
  dnsMs: z.number().nullable(),
  tcpMs: z.number().nullable(),
  tlsMs: z.number().nullable(),
  ttfbMs: z.number().nullable(),
  serverMs: z.number().nullable(),
});
export type StatusPhases = z.infer<typeof statusPhasesSchema>;

export const statusFailureReasonSchema = z.object({
  classification: checkClassificationSchema,
  count: z.number(),
});

export const statusIncidentStatsSchema = z.object({
  windowDays: z.number(),
  confirmedCount: z.number(),
  resolvedCount: z.number(),
  /** Sum of resolved incident durations, in seconds. */
  totalDowntimeSeconds: z.number().nullable(),
  /** Mean resolved duration: the service's MTTR. */
  averageDownSeconds: z.number().nullable(),
  longestDownSeconds: z.number().nullable(),
  lastIncidentAt: dateString.nullable(),
});
export type StatusIncidentStats = z.infer<typeof statusIncidentStatsSchema>;

export const statusCertificateSchema = z.object({
  issuer: z.string(),
  subject: z.string(),
  validTo: dateString,
  daysRemaining: z.number(),
});
export type StatusCertificate = z.infer<typeof statusCertificateSchema>;

/** What the monitor is actually configured to do — transparency over marketing. */
export const statusCoverageSchema = z.object({
  intervalSeconds: z.number(),
  timeoutMs: z.number(),
  totalChecks: z.number(),
  lastCheckAt: dateString.nullable(),
  nextCheckAt: dateString.nullable(),
});
export type StatusCoverage = z.infer<typeof statusCoverageSchema>;

/**
 * Uptime against a declared objective. The 99.9 % target is a published
 * reference point, not a contract: the UI labels it "objectif" and the error
 * budget is derived arithmetically from measured checks.
 */
export const statusSlaSchema = z.object({
  targetPercent: z.number(),
  windowDays: z.number(),
  /** Minutes of unavailability still available before the target is missed. */
  errorBudgetMinutes: z.number().nullable(),
  consumedMinutes: z.number().nullable(),
});
export type StatusSla = z.infer<typeof statusSlaSchema>;

export const publicMonitorStatusSchema = z.object({
  id: z.number(),
  name: z.string(),
  url: z.string(),
  status: monitorStatusSchema,
  uptimePercent: z.number().nullable(),
  nextCheckAt: dateString.nullable().default(null),
  days: z.array(statusDaySchema),
  windows: z.object({
    d1: statusWindowSchema,
    d7: statusWindowSchema,
    d30: statusWindowSchema,
    d90: statusWindowSchema,
  }),
  hourly: z.array(statusHourSchema),
  latency: statusLatencySchema,
  phases: statusPhasesSchema,
  failures: z.array(statusFailureReasonSchema),
  incidents: statusIncidentStatsSchema,
  certificate: statusCertificateSchema.nullable(),
  coverage: statusCoverageSchema,
  sla: statusSlaSchema,
});
export type PublicMonitorStatus = z.infer<typeof publicMonitorStatusSchema>;

export const publicStatusIncidentSchema = z.object({
  id: z.number(),
  monitorName: z.string(),
  status: z.enum(["suspect", "confirmed", "resolved"]),
  startedAt: dateString,
  confirmedAt: dateString.nullable(),
  resolvedAt: dateString.nullable(),
  durationSeconds: z.number().nullable(),
  /** Seconds since the incident started, for an ongoing incident; null once resolved. */
  elapsedSeconds: z.number().nullable(),
  reason: z.string().nullable(),
});
export type PublicStatusIncident = z.infer<typeof publicStatusIncidentSchema>;

export const publicStatusSummarySchema = z.object({
  services: z.number(),
  pausedServices: z.number(),
  checks24h: z.number(),
  globalUptimePercent: z.number().nullable(),
  globalMedianLatencyMs: z.number().nullable(),
  incidents90d: z.number(),
  downtime90dSeconds: z.number(),
  activeIncidents: z.number(),
  certificatesExpiringSoon: z.number(),
});
export type PublicStatusSummary = z.infer<typeof publicStatusSummarySchema>;

/** How the numbers are produced. Rendered on the page so the data is auditable. */
export const publicStatusMethodologySchema = z.object({
  failureThreshold: z.number(),
  recoveryThreshold: z.number(),
  retentionDays: z.number(),
  windowDays: z.number(),
  latencySampleWindowDays: z.number(),
  latencySampleCap: z.number(),
  minIntervalSeconds: z.number(),
  measuredPhases: z.array(z.string()),
});
export type PublicStatusMethodology = z.infer<
  typeof publicStatusMethodologySchema
>;

export const publicStatusResponseSchema = z.object({
  title: z.string(),
  description: z.string().nullable(),
  overall: z.enum(["operational", "outage", "empty"]),
  days: z.number(),
  summary: publicStatusSummarySchema,
  methodology: publicStatusMethodologySchema,
  monitors: z.array(publicMonitorStatusSchema),
  incidents: z.array(publicStatusIncidentSchema),
  generatedAt: dateString,
});
export type PublicStatusData = z.infer<typeof publicStatusResponseSchema>;
/**
 * The pre-transform shape: `dateString` accepts a `Date` and emits an ISO
 * string, so server code that builds the payload in memory types against this.
 */
export type PublicStatusPayload = z.input<typeof publicStatusResponseSchema>;

/* ------------------------------------------------------------------ *
 * Qualité & support
 *
 * The module automates what a QA/support agent used to do by hand: capture a
 * client-reported problem with its reproduction steps and evidence, turn it
 * into a structured internal report, answer the client in French, run
 * functional self-checks that open anomalies automatically, and publish a
 * daily digest while tracking every ticket to resolution.
 * ------------------------------------------------------------------ */

export const QA_TICKET_SOURCES = ["client", "auto", "internal"] as const;
export const QA_TICKET_KINDS = ["bug", "behaviour", "ux"] as const;
export const QA_TICKET_SEVERITIES = ["P1", "P2", "P3", "P4"] as const;
export const QA_TICKET_STATUSES = [
  "new",
  "triaged",
  "in_progress",
  "waiting_client",
  "resolved",
  "closed",
] as const;
export const QA_EVENT_AUTHORS = ["client", "support", "system"] as const;
export const QA_RUN_STATUSES = ["ok", "attention", "failed"] as const;
export type QaRunStatus = (typeof QA_RUN_STATUSES)[number];

/** Everything except these two statuses still needs an operator. */
export const QA_OPEN_STATUSES = [
  "new",
  "triaged",
  "in_progress",
  "waiting_client",
] as const;

/**
 * Minutes without any activity before a ticket counts as a follow-up breach.
 * Shared because the queue has to highlight the same tickets the digest
 * relances, from the same number.
 */
export const QA_OVERDUE_AFTER_MINUTES = 48 * 60;

export const qaTicketSourceLabels: Record<QaTicketSource, string> = {
  client: "Signalé par un client",
  auto: "Détecté par les auto-tests",
  internal: "Interne",
};
export const qaTicketKindLabels: Record<QaTicketKind, string> = {
  bug: "Bug",
  behaviour: "Comportement inattendu",
  ux: "Ergonomie",
};
export const qaTicketSeverityLabels: Record<QaTicketSeverity, string> = {
  P1: "Bloquant",
  P2: "Majeur",
  P3: "Normal",
  P4: "Mineur",
};
export const qaTicketStatusLabels: Record<QaTicketStatus, string> = {
  new: "Nouveau",
  triaged: "Trié",
  in_progress: "En cours",
  waiting_client: "En attente du client",
  resolved: "Résolu",
  closed: "Clos",
};
/** Who wrote a timeline entry, in the words a French report prints. */
export const qaTicketEventAuthorLabels: Record<QaEventAuthor, string> = {
  client: "Client",
  support: "Équipe qualité",
  system: "Système",
};

/** Human-facing ticket reference, derived from the id so it can never drift. */
export function qaReference(id: number): string {
  return `UP-${String(id).padStart(5, "0")}`;
}

/** Legal forward transitions, enforced by the API rather than the UI. */
export const QA_STATUS_TRANSITIONS: Record<QaTicketStatus, QaTicketStatus[]> = {
  new: ["triaged", "in_progress", "waiting_client", "resolved", "closed"],
  triaged: ["in_progress", "waiting_client", "resolved", "closed"],
  in_progress: ["waiting_client", "resolved", "closed"],
  waiting_client: ["in_progress", "resolved", "closed"],
  resolved: ["closed", "in_progress"],
  closed: [],
};

export type QaTicketSource = (typeof QA_TICKET_SOURCES)[number];
export type QaTicketKind = (typeof QA_TICKET_KINDS)[number];
export type QaTicketSeverity = (typeof QA_TICKET_SEVERITIES)[number];
export type QaTicketStatus = (typeof QA_TICKET_STATUSES)[number];
export type QaEventAuthor = (typeof QA_EVENT_AUTHORS)[number];

/**
 * Context the browser captures on its own when a problem is reported. Every
 * field is length- or count-bounded: the payload crosses a public endpoint, and
 * the reporter is not trusted to keep it small.
 */
export const qaEvidenceSchema = z.object({
  capturedAt: z.string().max(40),
  route: z.string().max(300),
  userAgent: z.string().max(300),
  locale: z.string().max(35),
  viewport: z
    .object({
      width: z.number().int().min(0).max(10_000),
      height: z.number().int().min(0).max(10_000),
    })
    .nullable()
    .default(null),
  javaScriptErrors: z
    .array(
      z.object({
        message: z.string().max(300),
        source: z.string().max(300),
        at: z.string().max(40),
      })
    )
    .max(10),
  failedRequests: z
    .array(
      z.object({
        path: z.string().max(300),
        status: z.number().int().nullable(),
        code: z.string().max(60).nullable(),
        durationMs: z.number().int().min(0).max(600_000).nullable(),
        at: z.string().max(40),
      })
    )
    .max(10),
});
export type QaEvidence = z.infer<typeof qaEvidenceSchema>;

/**
 * Public intake. `clientMessage` keeps the reporter's own wording — the
 * internal report is derived from it, so rewriting it here would destroy the
 * evidence trail. `website` is a hidden honeypot: a filled one is a bot.
 */
export const qaTicketCreateSchema = z.object({
  title: z.string().trim().min(5).max(160),
  clientMessage: z.string().trim().min(10).max(4_000),
  kind: z.enum(QA_TICKET_KINDS).default("bug"),
  steps: z.string().trim().max(2_000).nullable().default(null),
  expected: z.string().trim().max(1_000).nullable().default(null),
  actual: z.string().trim().max(1_000).nullable().default(null),
  reporterName: z.string().trim().max(120).nullable().default(null),
  reporterEmail: emailSchema.nullable().default(null),
  pageUrl: z.string().trim().max(2_048).nullable().default(null),
  statusSlug: z
    .string()
    .trim()
    .regex(/^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/)
    .nullable()
    .default(null),
  evidence: qaEvidenceSchema.nullable().default(null),
  website: z.string().max(200).default(""),
});
export type QaTicketCreate = z.infer<typeof qaTicketCreateSchema>;

/** What an authenticated user may set on a ticket. */
export const qaTicketUpdateSchema = z.object({
  status: z.enum(QA_TICKET_STATUSES).optional(),
  severity: z.enum(QA_TICKET_SEVERITIES).optional(),
  kind: z.enum(QA_TICKET_KINDS).optional(),
  title: z.string().trim().min(5).max(160).optional(),
});
export type QaTicketUpdate = z.infer<typeof qaTicketUpdateSchema>;

export const qaTicketEventCreateSchema = z.object({
  body: z.string().trim().min(1).max(4_000),
  visibility: z.enum(["public", "internal"]).default("public"),
});

export const qaTicketEventSchema = z.object({
  id: z.number(),
  author: z.enum(QA_EVENT_AUTHORS),
  visibility: z.enum(["public", "internal"]),
  body: z.string(),
  fromStatus: z.enum(QA_TICKET_STATUSES).nullable(),
  toStatus: z.enum(QA_TICKET_STATUSES).nullable(),
  createdAt: dateString,
});
export type QaTicketEvent = z.infer<typeof qaTicketEventSchema>;

export const qaTicketSchema = z.object({
  id: z.number(),
  source: z.enum(QA_TICKET_SOURCES),
  kind: z.enum(QA_TICKET_KINDS),
  severity: z.enum(QA_TICKET_SEVERITIES),
  status: z.enum(QA_TICKET_STATUSES),
  title: z.string(),
  clientMessage: z.string(),
  steps: z.string().nullable(),
  expected: z.string().nullable(),
  actual: z.string().nullable(),
  reporterName: z.string().nullable(),
  reporterEmail: z.string().nullable(),
  pageUrl: z.string().nullable(),
  monitorId: z.number().nullable(),
  monitorName: z.string().nullable(),
  evidence: qaEvidenceSchema.nullable(),
  /** Minutes since the last public activity; the follow-up SLA of the role. */
  idleMinutes: z.number(),
  createdAt: dateString,
  updatedAt: dateString,
  resolvedAt: dateString.nullable(),
});
export type QaTicket = z.infer<typeof qaTicketSchema>;

/** The reporter's own view: no internal notes, no e-mail, no fingerprints. */
export const qaPublicTicketSchema = z.object({
  id: z.number(),
  title: z.string(),
  kind: z.enum(QA_TICKET_KINDS),
  severity: z.enum(QA_TICKET_SEVERITIES),
  status: z.enum(QA_TICKET_STATUSES),
  clientMessage: z.string(),
  steps: z.string().nullable(),
  expected: z.string().nullable(),
  actual: z.string().nullable(),
  pageUrl: z.string().nullable(),
  monitorName: z.string().nullable(),
  createdAt: dateString,
  updatedAt: dateString,
  resolvedAt: dateString.nullable(),
});
export type QaPublicTicket = z.infer<typeof qaPublicTicketSchema>;

export const qaTotalsSchema = z.object({
  open: z.number(),
  fresh: z.number(),
  waitingClient: z.number(),
  autoOpen: z.number(),
  resolvedThisWeek: z.number(),
  /** Open tickets with no public activity for 48 h: the follow-up breach. */
  overdue: z.number(),
});
export type QaTotals = z.infer<typeof qaTotalsSchema>;

export const qaTicketsResponseSchema = z.object({
  tickets: z.array(qaTicketSchema),
  totals: qaTotalsSchema,
});
export type QaTicketsResponse = z.infer<typeof qaTicketsResponseSchema>;

export const qaTicketDetailResponseSchema = z.object({
  ticket: qaTicketSchema,
  events: z.array(qaTicketEventSchema),
  /** Raw token so the operator can send the follow-up link; null when absent. */
  reporterToken: z.string().nullable(),
  /** Markdown report for the technical team, generated on read. */
  internalReport: z.string(),
});
export type QaTicketDetailResponse = z.infer<
  typeof qaTicketDetailResponseSchema
>;

export const qaPublicTicketResponseSchema = z.object({
  ticket: qaPublicTicketSchema,
  events: z.array(qaTicketEventSchema),
});
export type QaPublicTicketResponse = z.infer<
  typeof qaPublicTicketResponseSchema
>;

export const qaSelfTestResultSchema = z.object({
  id: z.string(),
  label: z.string(),
  ok: z.boolean(),
  /** The invariant that was checked, in plain French: what should hold. */
  expected: z.string(),
  /** What was actually observed, including the measured numbers. */
  actual: z.string(),
  severity: z.enum(QA_TICKET_SEVERITIES),
  ticketId: z.number().nullable(),
});
export type QaSelfTestResult = z.infer<typeof qaSelfTestResultSchema>;

export const qaSelfTestRunSchema = z.object({
  periodKey: z.string(),
  status: z.enum(QA_RUN_STATUSES),
  startedAt: dateString,
  finishedAt: dateString.nullable(),
  results: z.array(qaSelfTestResultSchema),
});
export type QaSelfTestRun = z.infer<typeof qaSelfTestRunSchema>;

export const qaDigestResponseSchema = z.object({
  date: z.string(),
  status: z.enum(QA_RUN_STATUSES),
  markdown: z.string(),
  totals: qaTotalsSchema,
  newCount: z.number(),
  resolvedCount: z.number(),
  autoCount: z.number(),
  generatedAt: dateString,
});
export type QaDigestResponse = z.infer<typeof qaDigestResponseSchema>;

export const qaOverviewResponseSchema = z.object({
  totals: qaTotalsSchema,
  tickets: z.array(qaTicketSchema),
  lastSelfTest: qaSelfTestRunSchema.nullable(),
  digest: qaDigestResponseSchema.nullable(),
  generatedAt: dateString,
});
export type QaOverviewResponse = z.infer<typeof qaOverviewResponseSchema>;

export const qaReplyTemplateSchema = z.object({
  kind: z.enum(["acknowledgement", "clarification", "resolution"]),
  body: z.string(),
});
export type QaReplyTemplate = z.infer<typeof qaReplyTemplateSchema>;

export const qaTicketReplyRequestSchema = z.object({
  kind: z.enum(["acknowledgement", "clarification", "resolution"]),
});

export const qaTicketReplyResponseSchema = z.object({
  template: qaReplyTemplateSchema,
});
export type QaTicketReplyResponse = z.infer<typeof qaTicketReplyResponseSchema>;

export const qaSelfTestRunResponseSchema = z.object({
  run: qaSelfTestRunSchema,
});

export const qaTicketResponseSchema = z.object({
  ticket: qaTicketSchema,
});

export const qaTicketCreatedResponseSchema = z.object({
  id: z.number(),
  reference: z.string(),
  reporterToken: z.string(),
});
export type QaTicketCreatedResponse = z.infer<
  typeof qaTicketCreatedResponseSchema
>;

export const qaTicketEventResponseSchema = z.object({
  event: qaTicketEventSchema,
});

/* -------------------------------------------------------------------------- */
/* Plans and creator console                                                   */
/*                                                                             */
/* Limits live in the database so the product owner can retune tiers without a */
/* deployment. The client renders quota copy from these same numbers, so it    */
/* can never claim a plan allows something the server refuses.                 */
/* -------------------------------------------------------------------------- */

export const planSlugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z][a-z0-9_-]{1,39}$/);

/**
 * The shape an account is entitled to. Kept identical to the server's effective
 * plan, so `/api/plan` cannot answer with a payload the client rejects: console
 * fields (`id`, `isPublic`, `sortOrder`) live in `planAdminSchema` only.
 */
export const planPublicSchema = z.object({
  slug: planSlugSchema,
  name: z.string(),
  maxMonitors: z.number(),
  minIntervalSeconds: z.number(),
  maxTimeoutMs: z.number(),
  maxChannels: z.number(),
  allowKeyword: z.boolean(),
  priceCents: z.number(),
  trialDays: z.number(),
});
export type PlanPublic = z.infer<typeof planPublicSchema>;

export const planAdminSchema = planPublicSchema.extend({
  id: z.number(),
  isPublic: z.boolean(),
  sortOrder: z.number(),
});
export type PlanAdmin = z.infer<typeof planAdminSchema>;

export const planUpsertSchema = z.object({
  slug: planSlugSchema,
  name: z.string().trim().min(1).max(60),
  maxMonitors: z.number().int().min(1).max(10_000),
  // 300 s is also the schema floor: the status-page percentile sample bound
  // is derived from it, so no plan may promise a shorter interval.
  minIntervalSeconds: z.number().int().min(300).max(86_400),
  maxTimeoutMs: z.number().int().min(1_000).max(30_000),
  maxChannels: z.number().int().min(1).max(50),
  allowKeyword: z.boolean(),
  priceCents: z.number().int().min(0).max(1_000_000),
  trialDays: z.number().int().min(0).max(365),
  isPublic: z.boolean().default(true),
  sortOrder: z.number().int().min(0).max(100).default(0),
});
export type PlanUpsertInput = z.infer<typeof planUpsertSchema>;

export const planListResponseSchema = z.object({
  plans: z.array(planPublicSchema),
});
export const planAdminListResponseSchema = z.object({
  plans: z.array(planAdminSchema),
});
export const planResponseSchema = z.object({ plan: planAdminSchema });

/** What the signed-in account is entitled to, plus what it already consumed. */
export const myPlanResponseSchema = z.object({
  plan: planPublicSchema,
  usage: z.object({ monitors: z.number(), channels: z.number() }),
  trialEndsAt: dateString.nullable(),
});
export type MyPlanResponse = z.infer<typeof myPlanResponseSchema>;

export const adminUserRowSchema = z.object({
  id: z.number(),
  email: z.string().nullable(),
  name: z.string().nullable(),
  role: z.enum(["user", "admin"]),
  planSlug: z.string(),
  planName: z.string(),
  monitorsUsed: z.number(),
  maxMonitors: z.number(),
  trialEndsAt: dateString.nullable(),
  lastSignedIn: dateString,
});
export type AdminUserRow = z.infer<typeof adminUserRowSchema>;

export const adminOverviewResponseSchema = z.object({
  totals: z.object({
    users: z.number(),
    admins: z.number(),
    monitors: z.number(),
    openIncidents: z.number(),
    keywordMonitors: z.number(),
  }),
  plans: z.array(
    z.object({
      slug: z.string(),
      name: z.string(),
      priceCents: z.number(),
      userCount: z.number(),
      monitorCount: z.number(),
    })
  ),
  users: z.array(adminUserRowSchema),
});
export type AdminOverview = z.infer<typeof adminOverviewResponseSchema>;

export const userPlanAssignmentSchema = z.object({
  planSlug: planSlugSchema,
  /** Days of trial to grant from now; 0 clears any running trial. */
  trialDays: z.number().int().min(0).max(365).default(0),
});
export type UserPlanAssignmentInput = z.infer<typeof userPlanAssignmentSchema>;
