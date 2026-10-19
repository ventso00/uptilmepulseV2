import {
  boolean,
  index,
  int,
  mysqlEnum,
  mysqlTable,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/mysql-core";

/**
 * Freemium tiers, editable at runtime so the product owner can retune limits
 * without a deployment. `users.planId` points here; a null plan falls back to
 * the `free` row instead of failing, so legacy accounts keep working.
 */
export const plans = mysqlTable(
  "plans",
  {
    id: int("id").autoincrement().primaryKey(),
    slug: varchar("slug", { length: 40 }).notNull(),
    name: varchar("name", { length: 60 }).notNull(),
    maxMonitors: int("maxMonitors").notNull().default(3),
    minIntervalSeconds: int("minIntervalSeconds").notNull().default(300),
    maxTimeoutMs: int("maxTimeoutMs").notNull().default(30_000),
    maxChannels: int("maxChannels").notNull().default(1),
    allowKeyword: boolean("allowKeyword").notNull().default(false),
    priceCents: int("priceCents").notNull().default(0),
    trialDays: int("trialDays").notNull().default(0),
    /** Whether the tier appears on the public pricing strip. */
    isPublic: boolean("isPublic").notNull().default(true),
    sortOrder: int("sortOrder").notNull().default(0),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    slugUnique: uniqueIndex("plans_slug_unique").on(table.slug),
    ordering: index("plans_sort_order_idx").on(table.sortOrder),
  })
);

export const users = mysqlTable("users", {
  id: int("id").autoincrement().primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  planId: int("planId").references(() => plans.id, { onDelete: "set null" }),
  /** Null once a trial has been consumed or never started for this account. */
  trialEndsAt: timestamp("trialEndsAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export const userCredentials = mysqlTable(
  "user_credentials",
  {
    userId: int("userId")
      .primaryKey()
      .references(() => users.id, { onDelete: "cascade" }),
    emailNormalized: varchar("emailNormalized", { length: 320 }).notNull(),
    passwordHash: varchar("passwordHash", { length: 255 }).notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    emailUnique: uniqueIndex("user_credentials_email_unique").on(
      table.emailNormalized
    ),
  })
);

export const sessions = mysqlTable(
  "sessions",
  {
    id: int("id").autoincrement().primaryKey(),
    tokenHash: varchar("tokenHash", { length: 128 }).notNull(),
    userId: int("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expiresAt").notNull(),
    revokedAt: timestamp("revokedAt"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => ({
    tokenUnique: uniqueIndex("sessions_token_hash_unique").on(table.tokenHash),
    userExpiry: index("sessions_user_expiry_idx").on(
      table.userId,
      table.expiresAt
    ),
  })
);

export const monitorStatusValues = ["UNKNOWN", "UP", "DOWN", "PAUSED"] as const;
export type MonitorStatus = (typeof monitorStatusValues)[number];

export const monitorKeywordModeValues = [
  "must_contain",
  "must_not_contain",
] as const;
export type MonitorKeywordMode = (typeof monitorKeywordModeValues)[number];

export const monitors = mysqlTable(
  "monitors",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 120 }).notNull(),
    url: varchar("url", { length: 2048 }).notNull(),
    intervalSeconds: int("intervalSeconds").notNull().default(300),
    timeoutMs: int("timeoutMs").notNull().default(10000),
    /**
     * Substring the body must (or must not) contain. Matched case-insensitively
     * against the first 256 KiB of the response; null disables content checks.
     */
    keyword: varchar("keyword", { length: 160 }),
    keywordMode: mysqlEnum("keywordMode", monitorKeywordModeValues)
      .notNull()
      .default("must_contain"),
    enabled: boolean("enabled").notNull().default(true),
    currentStatus: mysqlEnum("currentStatus", monitorStatusValues)
      .notNull()
      .default("UNKNOWN"),
    consecutiveFailures: int("consecutiveFailures").notNull().default(0),
    consecutiveSuccesses: int("consecutiveSuccesses").notNull().default(0),
    nextCheckAt: timestamp("nextCheckAt").notNull().defaultNow(),
    lastCheckAt: timestamp("lastCheckAt"),
    sslIssuer: varchar("sslIssuer", { length: 255 }),
    sslSubject: varchar("sslSubject", { length: 255 }),
    sslValidTo: timestamp("sslValidTo"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    ownerDue: index("monitors_owner_due_idx").on(
      table.userId,
      table.enabled,
      table.nextCheckAt
    ),
    due: index("monitors_enabled_next_check_idx").on(
      table.enabled,
      table.nextCheckAt
    ),
  })
);

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
export type CheckClassification = (typeof checkClassificationValues)[number];

export const pingLogs = mysqlTable(
  "ping_logs",
  {
    id: int("id").autoincrement().primaryKey(),
    monitorId: int("monitorId")
      .notNull()
      .references(() => monitors.id, { onDelete: "cascade" }),
    statusCode: int("statusCode"),
    responseTimeMs: int("responseTimeMs"),
    dnsMs: int("dnsMs"),
    tcpMs: int("tcpMs"),
    tlsMs: int("tlsMs"),
    ttfbMs: int("ttfbMs"),
    isUp: boolean("isUp").notNull(),
    classification: mysqlEnum(
      "classification",
      checkClassificationValues
    ).notNull(),
    errorMessage: varchar("errorMessage", { length: 500 }),
    checkedAt: timestamp("checkedAt").defaultNow().notNull(),
  },
  table => ({
    history: index("ping_logs_monitor_checked_idx").on(
      table.monitorId,
      table.checkedAt
    ),
  })
);

export const incidentStatusValues = [
  "suspect",
  "confirmed",
  "resolved",
] as const;
export type IncidentStatus = (typeof incidentStatusValues)[number];

export const incidents = mysqlTable(
  "incidents",
  {
    id: int("id").autoincrement().primaryKey(),
    monitorId: int("monitorId")
      .notNull()
      .references(() => monitors.id, { onDelete: "cascade" }),
    startedAt: timestamp("startedAt").notNull(),
    confirmedAt: timestamp("confirmedAt"),
    resolvedAt: timestamp("resolvedAt"),
    durationSeconds: int("durationSeconds"),
    status: mysqlEnum("status", incidentStatusValues)
      .notNull()
      .default("suspect"),
    reason: varchar("reason", { length: 500 }),
    lastFailureLogId: int("lastFailureLogId").references(() => pingLogs.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    monitorStatus: index("incidents_monitor_status_idx").on(
      table.monitorId,
      table.status
    ),
  })
);

export const notificationChannelTypeValues = ["telegram"] as const;
export const notificationDeliveryTypeValues = [
  "failure",
  "recovery",
  "test",
] as const;
export const notificationDeliveryStatusValues = [
  "pending",
  "sent",
  "failed",
] as const;

export const notificationChannels = mysqlTable(
  "notification_channels",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: mysqlEnum("type", notificationChannelTypeValues).notNull(),
    configurationEncrypted: text("configurationEncrypted").notNull(),
    enabled: boolean("enabled").notNull().default(true),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    userType: index("notification_channels_user_type_idx").on(
      table.userId,
      table.type
    ),
  })
);

export const notificationDeliveries = mysqlTable(
  "notification_deliveries",
  {
    id: int("id").autoincrement().primaryKey(),
    incidentId: int("incidentId")
      .notNull()
      .references(() => incidents.id, { onDelete: "cascade" }),
    channelId: int("channelId")
      .notNull()
      .references(() => notificationChannels.id, { onDelete: "cascade" }),
    type: mysqlEnum("type", notificationDeliveryTypeValues).notNull(),
    status: mysqlEnum("status", notificationDeliveryStatusValues)
      .notNull()
      .default("pending"),
    attempts: int("attempts").notNull().default(0),
    lastError: varchar("lastError", { length: 500 }),
    sentAt: timestamp("sentAt"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    incidentChannel: index("notification_deliveries_incident_channel_idx").on(
      table.incidentId,
      table.channelId
    ),
    incidentChannelTypeUnique: uniqueIndex(
      "notification_deliveries_incident_channel_type_unique"
    ).on(table.incidentId, table.channelId, table.type),
    // The retry pass scans failed/pending rows on every scheduler tick. Without
    // this index that scan was a full table scan once per minute.
    retryQueue: index("notification_deliveries_retry_queue_idx").on(
      table.status,
      table.createdAt
    ),
  })
);

export const statusPages = mysqlTable("status_pages", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId")
    .notNull()
    .unique()
    .references(() => users.id, { onDelete: "cascade" }),
  slug: varchar("slug", { length: 64 }).notNull().unique(),
  title: varchar("title", { length: 120 }).notNull(),
  description: varchar("description", { length: 500 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

/**
 * Quality & support module: the client-reported issue and the self-test
 * anomaly live in one table so both follow the same lifecycle, the same
 * evidence trail and the same daily digest.
 */
export const qaTicketSourceValues = ["client", "auto", "internal"] as const;
export const qaTicketKindValues = ["bug", "behaviour", "ux"] as const;
export const qaTicketSeverityValues = ["P1", "P2", "P3", "P4"] as const;
export const qaTicketStatusValues = [
  "new",
  "triaged",
  "in_progress",
  "waiting_client",
  "resolved",
  "closed",
] as const;
export const qaTicketAuthorValues = ["client", "support", "system"] as const;
export const qaTicketVisibilityValues = ["public", "internal"] as const;

export const qaTickets = mysqlTable(
  "qa_tickets",
  {
    id: int("id").autoincrement().primaryKey(),
    /** Owner of the account the issue concerns; system-wide anomalies go to the QA owner. */
    userId: int("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    source: mysqlEnum("source", qaTicketSourceValues).notNull(),
    kind: mysqlEnum("kind", qaTicketKindValues).notNull().default("bug"),
    severity: mysqlEnum("severity", qaTicketSeverityValues)
      .notNull()
      .default("P3"),
    status: mysqlEnum("status", qaTicketStatusValues).notNull().default("new"),
    title: varchar("title", { length: 160 }).notNull(),
    /** Verbatim client wording, never rewritten: the internal report is derived from it. */
    clientMessage: text("clientMessage").notNull(),
    steps: text("steps"),
    expected: text("expected"),
    actual: text("actual"),
    reporterName: varchar("reporterName", { length: 120 }),
    reporterEmail: varchar("reporterEmail", { length: 320 }),
    /** Read-only follow-up token handed to the reporter; null for internal tickets. */
    reporterToken: varchar("reporterToken", { length: 64 }).unique(),
    pageUrl: varchar("pageUrl", { length: 2048 }),
    monitorId: int("monitorId").references(() => monitors.id, {
      onDelete: "set null",
    }),
    /** Serialised capture context (route, UA, viewport, JS + API errors). Bounded server-side. */
    evidence: text("evidence"),
    /**
     * Set only while an auto-detected anomaly is open, so a persistent failure
     * updates one ticket instead of opening a new one every pass. Cleared on
     * resolution, which lets a recurrence open a fresh ticket.
     */
    fingerprint: varchar("fingerprint", { length: 64 }).unique(),
    resolvedAt: timestamp("resolvedAt"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    ownerStatus: index("qa_tickets_owner_status_idx").on(
      table.userId,
      table.status
    ),
    openQueue: index("qa_tickets_open_idx").on(table.status, table.createdAt),
    source: index("qa_tickets_source_idx").on(table.source, table.createdAt),
  })
);

export const qaTicketEvents = mysqlTable(
  "qa_ticket_events",
  {
    id: int("id").autoincrement().primaryKey(),
    ticketId: int("ticketId")
      .notNull()
      .references(() => qaTickets.id, { onDelete: "cascade" }),
    author: mysqlEnum("author", qaTicketAuthorValues).notNull(),
    /** `internal` notes never leave the operator UI nor the reporter's link. */
    visibility: mysqlEnum("visibility", qaTicketVisibilityValues)
      .notNull()
      .default("public"),
    body: text("body").notNull(),
    fromStatus: mysqlEnum("fromStatus", qaTicketStatusValues),
    toStatus: mysqlEnum("toStatus", qaTicketStatusValues),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => ({
    timeline: index("qa_ticket_events_ticket_created_idx").on(
      table.ticketId,
      table.createdAt
    ),
  })
);

export const qaRunKindValues = ["self_test", "daily_digest"] as const;
export const qaRunStatusValues = ["ok", "attention", "failed"] as const;

/**
 * Idempotency ledger for the recurring QA jobs. The unique (kind, periodKey)
 * insert is the claim: with several instances or an external cron, only one
 * pass wins a given period, and a crash after the claim is visible because
 * `finishedAt` stays null.
 */
export const qaRuns = mysqlTable(
  "qa_runs",
  {
    id: int("id").autoincrement().primaryKey(),
    kind: mysqlEnum("kind", qaRunKindValues).notNull(),
    periodKey: varchar("periodKey", { length: 32 }).notNull(),
    status: mysqlEnum("status", qaRunStatusValues).notNull().default("ok"),
    summary: varchar("summary", { length: 500 }),
    detail: text("detail"),
    startedAt: timestamp("startedAt").defaultNow().notNull(),
    finishedAt: timestamp("finishedAt"),
  },
  table => ({
    periodUnique: uniqueIndex("qa_runs_kind_period_unique").on(
      table.kind,
      table.periodKey
    ),
  })
);

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;
export type Plan = typeof plans.$inferSelect;
export type UserCredential = typeof userCredentials.$inferSelect;
export type Session = typeof sessions.$inferSelect;
export type Monitor = typeof monitors.$inferSelect;
export type PingLog = typeof pingLogs.$inferSelect;
export type Incident = typeof incidents.$inferSelect;
export type NotificationChannel = typeof notificationChannels.$inferSelect;
export type NotificationDelivery = typeof notificationDeliveries.$inferSelect;
export type StatusPage = typeof statusPages.$inferSelect;
export type QaTicket = typeof qaTickets.$inferSelect;
export type InsertQaTicket = typeof qaTickets.$inferInsert;
export type QaTicketEvent = typeof qaTicketEvents.$inferSelect;
export type QaRun = typeof qaRuns.$inferSelect;
