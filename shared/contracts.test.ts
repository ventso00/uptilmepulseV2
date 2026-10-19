import { describe, expect, it } from "vitest";
import { checkClassificationValues as schemaClassificationValues } from "./db/schema";
import {
  authUserResponseSchema,
  checkClassificationLabels,
  checkClassificationValues,
  dashboardResponseSchema,
  historyResponseSchema,
  monitorSchema,
  monitorCheckResponseSchema,
  monitorKeywordModeLabels,
  monitorKeywordModeValues,
  monitorUpdateSchema,
  API_ERROR_CODES,
  monitorCreateSchema,
  periodSchema,
  planPublicSchema,
  planSlugSchema,
  planUpsertSchema,
  registerSchema,
  publicStatusResponseSchema,
  statusPageResponseSchema,
  statusPageUpsertSchema,
  QA_OPEN_STATUSES,
  QA_OVERDUE_AFTER_MINUTES,
  QA_STATUS_TRANSITIONS,
  QA_TICKET_STATUSES,
  qaEvidenceSchema,
  qaPublicTicketSchema,
  qaReference,
  qaSelfTestResultSchema,
  qaTicketCreateSchema,
  qaTicketEventCreateSchema,
  qaTicketReplyRequestSchema,
  qaTicketSchema,
} from "./contracts";

/**
 * These assert the contract boundary the client now parses against. The
 * previous client used an unchecked `as T` cast, so a server shape change
 * produced `undefined` at render instead of a visible error.
 */
describe("response contracts", () => {
  it("normalises Date instances to ISO strings in monitor payloads", () => {
    const parsed = monitorSchema.parse({
      id: 1,
      name: "API",
      url: "https://api.exemple.com",
      intervalSeconds: 300,
      timeoutMs: 10_000,
      enabled: true,
      status: "UP",
      consecutiveFailures: 0,
      consecutiveSuccesses: 4,
      uptimePercent: 99.98,
      averageResponseTimeMs: 184,
      lastCheckAt: new Date("2026-01-02T03:04:05.000Z"),
      nextCheckAt: new Date("2026-01-02T03:09:05.000Z"),
      latestCheck: {
        statusCode: 200,
        responseTimeMs: 184,
        isUp: true,
        classification: "UP_HTTP_2XX",
        checkedAt: new Date("2026-01-02T03:04:05.000Z"),
      },
    });
    expect(parsed.nextCheckAt).toBe("2026-01-02T03:09:05.000Z");
    expect(parsed.latestCheck?.checkedAt).toBe("2026-01-02T03:04:05.000Z");
  });

  it("accepts the null-heavy shape a brand new monitor produces", () => {
    const parsed = monitorSchema.parse({
      id: 7,
      name: "Blog",
      url: "https://blog.exemple.com",
      intervalSeconds: 300,
      timeoutMs: 10_000,
      enabled: true,
      status: "UNKNOWN",
      consecutiveFailures: 0,
      consecutiveSuccesses: 0,
      uptimePercent: null,
      averageResponseTimeMs: null,
      lastCheckAt: null,
      nextCheckAt: new Date("2026-01-02T03:04:05.000Z"),
      latestCheck: null,
    });
    expect(parsed.latestCheck).toBeNull();
    expect(parsed.uptimePercent).toBeNull();
  });

  it("rejects an unknown classification instead of trusting it", () => {
    const result = monitorSchema.safeParse({
      id: 1,
      name: "API",
      url: "https://api.exemple.com",
      intervalSeconds: 300,
      timeoutMs: 10_000,
      enabled: true,
      status: "UP",
      consecutiveFailures: 0,
      consecutiveSuccesses: 1,
      uptimePercent: 100,
      averageResponseTimeMs: 10,
      lastCheckAt: null,
      nextCheckAt: new Date(),
      latestCheck: {
        statusCode: 200,
        responseTimeMs: 10,
        isUp: true,
        classification: "TOTALLY_MADE_UP",
        checkedAt: new Date(),
      },
    });
    expect(result.success).toBe(false);
  });

  it("rejects an unknown monitor status", () => {
    const result = monitorSchema.safeParse({
      id: 1,
      name: "API",
      url: "https://api.exemple.com",
      intervalSeconds: 300,
      timeoutMs: 10_000,
      enabled: true,
      status: "DEGRADED",
      consecutiveFailures: 0,
      consecutiveSuccesses: 0,
      uptimePercent: null,
      averageResponseTimeMs: null,
      lastCheckAt: null,
      nextCheckAt: new Date(),
      latestCheck: null,
    });
    expect(result.success).toBe(false);
  });

  it("requires the pagination fields the detail page depends on", () => {
    const result = historyResponseSchema.safeParse({ logs: [] });
    expect(result.success).toBe(false);
    expect(
      historyResponseSchema.safeParse({ logs: [], total: 0, hasMore: false })
        .success
    ).toBe(true);
  });

  it("parses a minimal dashboard payload", () => {
    const parsed = dashboardResponseSchema.parse({
      summary: {
        totalMonitors: 1,
        upMonitors: 1,
        downMonitors: 0,
        pausedMonitors: 0,
        uptimePercent: null,
        activeIncidents: 0,
        averageResponseTimeMs: null,
      },
      monitors: [],
      incidents: [],
    });
    expect(parsed.summary.totalMonitors).toBe(1);
  });

  it("parses the auth payload", () => {
    expect(
      authUserResponseSchema.parse({
        user: { id: 1, email: "a@b.c", name: null },
      }).user.email
    ).toBe("a@b.c");
  });

  it("defaults recentChecks so endpoints without the strip still validate", () => {
    const parsed = monitorSchema.parse({
      id: 1,
      name: "x",
      url: "https://a.co",
      intervalSeconds: 300,
      timeoutMs: 10_000,
      enabled: true,
      status: "UNKNOWN",
      consecutiveFailures: 0,
      consecutiveSuccesses: 0,
      uptimePercent: null,
      averageResponseTimeMs: null,
      lastCheckAt: null,
      nextCheckAt: new Date(),
      latestCheck: null,
    });
    expect(parsed.recentChecks).toEqual([]);
  });

  it("accepts the manual check response shapes", () => {
    expect(monitorCheckResponseSchema.parse({ check: null }).check).toBeNull();
    expect(
      monitorCheckResponseSchema.parse({
        check: {
          isUp: true,
          statusCode: 200,
          responseTimeMs: 42,
          classification: "UP_HTTP_2XX",
          incidentAction: "none",
        },
      }).check?.statusCode
    ).toBe(200);
    expect(
      monitorCheckResponseSchema.parse({
        check: {
          isUp: true,
          statusCode: 200,
          responseTimeMs: 42,
          dnsMs: 5,
          ttfbMs: 30,
          classification: "UP_HTTP_2XX",
          incidentAction: "none",
        },
      }).check?.ttfbMs
    ).toBe(30);
  });

  it("defaults the new phase and ssl fields so older payloads still validate", () => {
    const parsed = monitorSchema.parse({
      id: 1,
      name: "x",
      url: "https://a.co",
      intervalSeconds: 300,
      timeoutMs: 10_000,
      enabled: true,
      status: "UP",
      consecutiveFailures: 0,
      consecutiveSuccesses: 1,
      uptimePercent: 100,
      averageResponseTimeMs: 10,
      lastCheckAt: null,
      nextCheckAt: new Date(),
      latestCheck: {
        statusCode: 200,
        responseTimeMs: 10,
        isUp: true,
        classification: "UP_HTTP_2XX",
        checkedAt: new Date(),
      },
    });
    expect(parsed.ssl).toBeNull();
    expect(parsed.latestCheck?.dnsMs).toBeNull();
    expect(parsed.latestCheck?.ttfbMs).toBeNull();
  });

  it("parses a monitor with phase timings and a TLS certificate", () => {
    const parsed = monitorSchema.parse({
      id: 2,
      name: "y",
      url: "https://b.co",
      intervalSeconds: 300,
      timeoutMs: 10_000,
      enabled: true,
      status: "UP",
      consecutiveFailures: 0,
      consecutiveSuccesses: 1,
      uptimePercent: 100,
      averageResponseTimeMs: 120,
      lastCheckAt: new Date(),
      nextCheckAt: new Date(),
      latestCheck: {
        statusCode: 200,
        responseTimeMs: 120,
        dnsMs: 12,
        tcpMs: 20,
        tlsMs: 35,
        ttfbMs: 50,
        isUp: true,
        classification: "UP_HTTP_2XX",
        checkedAt: new Date(),
      },
      ssl: {
        issuer: "DigiCert Inc",
        subject: "b.co",
        validTo: new Date("2027-01-01T00:00:00.000Z"),
      },
    });
    expect(parsed.latestCheck?.tlsMs).toBe(35);
    expect(parsed.ssl?.validTo).toBe("2027-01-01T00:00:00.000Z");
  });

  it("defaults phase columns on history logs", () => {
    const parsed = historyResponseSchema.parse({
      logs: [
        {
          id: 1,
          statusCode: 200,
          responseTimeMs: 42,
          isUp: true,
          classification: "UP_HTTP_2XX",
          errorMessage: null,
          checkedAt: "2026-10-08T00:00:00.000Z",
        },
      ],
      total: 1,
      hasMore: false,
    });
    expect(parsed.logs[0]?.dnsMs).toBeNull();
    expect(parsed.logs[0]?.ttfbMs).toBeNull();
  });
});

describe("request contracts", () => {
  it("keeps the free-plan interval floor", () => {
    expect(
      monitorCreateSchema.safeParse({
        name: "x",
        url: "https://a.co",
        intervalSeconds: 60,
      }).success
    ).toBe(false);
    expect(
      monitorCreateSchema.parse({ name: "x", url: "https://a.co" })
        .intervalSeconds
    ).toBe(300);
  });

  it("applies the documented default timeout", () => {
    expect(
      monitorCreateSchema.parse({ name: "x", url: "https://a.co" }).timeoutMs
    ).toBe(10_000);
  });

  it("defaults the period to 24h", () => {
    expect(periodSchema.parse(undefined)).toBe("24h");
    expect(periodSchema.safeParse("90d").success).toBe(false);
  });

  it("keeps the password policy in force", () => {
    expect(
      registerSchema.safeParse({ email: "a@b.co", password: "short" }).success
    ).toBe(false);
    expect(
      registerSchema.safeParse({
        email: "a@b.co",
        password: "longenoughpassword",
      }).success
    ).toBe(true);
  });

  it("exposes stable error codes", () => {
    expect(API_ERROR_CODES.QUOTA_EXCEEDED).toBe("QUOTA_EXCEEDED");
  });
});

describe("status page contracts", () => {
  it("accepts well-formed slugs and rejects tricks", () => {
    expect(
      statusPageUpsertSchema.safeParse({
        slug: "mes-services",
        title: "T",
        description: null,
      }).success
    ).toBe(true);
    expect(
      statusPageUpsertSchema.parse({
        slug: "UPPER",
        title: "T",
        description: null,
      }).slug
    ).toBe("upper");
    expect(
      statusPageUpsertSchema.safeParse({
        slug: "../admin",
        title: "T",
        description: null,
      }).success
    ).toBe(false);
    expect(
      statusPageUpsertSchema.safeParse({
        slug: "-lead",
        title: "T",
        description: null,
      }).success
    ).toBe(false);
    expect(
      statusPageUpsertSchema.safeParse({
        slug: "a",
        title: "T",
        description: null,
      }).success
    ).toBe(true);
    expect(
      statusPageUpsertSchema.safeParse({
        slug: "",
        title: "T",
        description: null,
      }).success
    ).toBe(false);
  });

  it("defaults the description to null and tolerates a missing one", () => {
    expect(
      statusPageUpsertSchema.parse({ slug: "x1", title: "Titre" }).description
    ).toBeNull();
  });

  /**
   * Mirrors the payload `server/statuspages/routes.ts` emits today: every
   * metric group the analysis builds must survive the parse, otherwise the
   * public page silently renders blanks instead of raising a contract error.
   */
  it("parses a public status payload with per-day buckets", () => {
    const parsed = publicStatusResponseSchema.parse({
      title: "Statut",
      description: null,
      overall: "operational",
      days: 90,
      summary: {
        services: 1,
        pausedServices: 0,
        checks24h: 288,
        globalUptimePercent: 99.65,
        globalMedianLatencyMs: 184,
        incidents90d: 2,
        downtime90dSeconds: 540,
        activeIncidents: 0,
        certificatesExpiringSoon: 0,
      },
      methodology: {
        failureThreshold: 3,
        recoveryThreshold: 1,
        retentionDays: 90,
        windowDays: 90,
        latencySampleWindowDays: 7,
        latencySampleCap: 2200,
        minIntervalSeconds: 300,
        measuredPhases: ["dns", "tcp", "tls", "ttfb"],
      },
      monitors: [
        {
          id: 1,
          name: "API",
          url: "https://api.exemple.com",
          status: "UP",
          uptimePercent: 99.5,
          nextCheckAt: "2026-10-08T08:05:00.000Z",
          days: [{ date: "2026-10-07", up: 287, down: 1 }],
          windows: {
            d1: { uptimePercent: 100, totalChecks: 288, failedChecks: 0 },
            d7: { uptimePercent: 99.95, totalChecks: 2016, failedChecks: 1 },
            d30: { uptimePercent: 99.9, totalChecks: 8640, failedChecks: 9 },
            d90: { uptimePercent: 99.5, totalChecks: 25920, failedChecks: 13 },
          },
          hourly: [
            {
              time: "2026-10-08T07:00:00.000Z",
              up: 12,
              down: 0,
              averageMs: 184,
              samples: 12,
            },
          ],
          latency: {
            windowDays: 7,
            sampleChecks: 2016,
            averageMs: 190,
            p50Ms: 184,
            p90Ms: 240,
            p95Ms: 268,
            maxMs: 1200,
            previousAverageMs: 205,
            trendPercent: -7.3,
          },
          phases: {
            windowDays: 7,
            sampleChecks: 2016,
            dnsMs: 12,
            tcpMs: 21,
            tlsMs: 34,
            ttfbMs: 117,
            serverMs: 50,
          },
          failures: [
            { classification: "DOWN_TIMEOUT", count: 7 },
            { classification: "DOWN_HTTP_5XX", count: 6 },
          ],
          incidents: {
            windowDays: 90,
            confirmedCount: 2,
            resolvedCount: 2,
            totalDowntimeSeconds: 540,
            averageDownSeconds: 270,
            longestDownSeconds: 400,
            lastIncidentAt: "2026-10-07T02:00:00.000Z",
          },
          certificate: {
            issuer: "Let's Encrypt",
            subject: "api.exemple.com",
            validTo: "2026-12-01T00:00:00.000Z",
            daysRemaining: 54,
          },
          coverage: {
            intervalSeconds: 300,
            timeoutMs: 10_000,
            totalChecks: 25920,
            lastCheckAt: "2026-10-08T08:00:00.000Z",
            nextCheckAt: "2026-10-08T08:05:00.000Z",
          },
          sla: {
            targetPercent: 99.9,
            windowDays: 90,
            errorBudgetMinutes: 25.92,
            consumedMinutes: 129.6,
          },
        },
      ],
      incidents: [
        {
          id: 9,
          monitorName: "API",
          status: "resolved",
          startedAt: "2026-10-07T02:00:00.000Z",
          confirmedAt: "2026-10-07T02:15:00.000Z",
          resolvedAt: "2026-10-07T02:21:00.000Z",
          durationSeconds: 360,
          elapsedSeconds: null,
          reason: "Timeout after 3 consecutive failures",
        },
      ],
      generatedAt: new Date("2026-10-08T08:00:00.000Z"),
    });
    expect(parsed.monitors[0].days[0].down).toBe(1);
    expect(parsed.generatedAt).toBe("2026-10-08T08:00:00.000Z");
    expect(parsed.summary.checks24h).toBe(288);
    expect(parsed.methodology.failureThreshold).toBe(3);
    expect(parsed.monitors[0].windows.d90.uptimePercent).toBe(99.5);
    expect(parsed.monitors[0].latency.p95Ms).toBe(268);
    expect(parsed.monitors[0].phases.serverMs).toBe(50);
    expect(parsed.monitors[0].incidents.averageDownSeconds).toBe(270);
    expect(parsed.monitors[0].certificate?.daysRemaining).toBe(54);
    expect(parsed.incidents[0].durationSeconds).toBe(360);
  });

  it("keeps a monitor without a certificate parseable", () => {
    const base = publicStatusResponseSchema.parse({
      title: "Statut",
      description: null,
      overall: "empty",
      days: 90,
      summary: {
        services: 1,
        pausedServices: 0,
        checks24h: 0,
        globalUptimePercent: null,
        globalMedianLatencyMs: null,
        incidents90d: 0,
        downtime90dSeconds: 0,
        activeIncidents: 0,
        certificatesExpiringSoon: 0,
      },
      methodology: {
        failureThreshold: 3,
        recoveryThreshold: 1,
        retentionDays: 90,
        windowDays: 90,
        latencySampleWindowDays: 7,
        latencySampleCap: 2200,
        minIntervalSeconds: 300,
        measuredPhases: ["dns", "tcp", "tls", "ttfb"],
      },
      monitors: [
        {
          id: 2,
          name: "Site HTTP",
          url: "http://site.exemple.com",
          status: "UNKNOWN",
          uptimePercent: null,
          days: [],
          windows: {
            d1: { uptimePercent: null, totalChecks: 0, failedChecks: 0 },
            d7: { uptimePercent: null, totalChecks: 0, failedChecks: 0 },
            d30: { uptimePercent: null, totalChecks: 0, failedChecks: 0 },
            d90: { uptimePercent: null, totalChecks: 0, failedChecks: 0 },
          },
          hourly: [],
          latency: {
            windowDays: 7,
            sampleChecks: 0,
            averageMs: null,
            p50Ms: null,
            p90Ms: null,
            p95Ms: null,
            maxMs: null,
            previousAverageMs: null,
            trendPercent: null,
          },
          phases: {
            windowDays: 7,
            sampleChecks: 0,
            dnsMs: null,
            tcpMs: null,
            tlsMs: null,
            ttfbMs: null,
            serverMs: null,
          },
          failures: [],
          incidents: {
            windowDays: 90,
            confirmedCount: 0,
            resolvedCount: 0,
            totalDowntimeSeconds: null,
            averageDownSeconds: null,
            longestDownSeconds: null,
            lastIncidentAt: null,
          },
          certificate: null,
          coverage: {
            intervalSeconds: 300,
            timeoutMs: 10_000,
            totalChecks: 0,
            lastCheckAt: null,
            nextCheckAt: null,
          },
          sla: {
            targetPercent: 99.9,
            windowDays: 90,
            errorBudgetMinutes: null,
            consumedMinutes: null,
          },
        },
      ],
      incidents: [],
      generatedAt: "2026-10-08T08:00:00.000Z",
    });
    expect(base.monitors[0].certificate).toBeNull();
    expect(base.monitors[0].windows.d1.uptimePercent).toBeNull();
    expect(base.monitors[0].nextCheckAt).toBeNull();
  });

  it("rejects a public payload missing the summary or methodology", () => {
    const withoutSummary = {
      title: "Statut",
      description: null,
      overall: "empty",
      days: 90,
      monitors: [],
      incidents: [],
      generatedAt: "2026-10-08T08:00:00.000Z",
    };
    expect(publicStatusResponseSchema.safeParse(withoutSummary).success).toBe(
      false
    );
    expect(
      publicStatusResponseSchema.safeParse({
        ...withoutSummary,
        summary: {},
        methodology: {},
      }).success
    ).toBe(false);
  });

  it("keeps statusPage nullable for users without a page", () => {
    expect(
      statusPageResponseSchema.parse({ statusPage: null }).statusPage
    ).toBeNull();
  });
});

/**
 * The QA contract is what keeps the client report, the operator queue and the
 * read-only follow-up link speaking the same language. The reference and the
 * transition table are printed to clients, so they are pinned here.
 */
describe("qa contracts", () => {
  it("pads the ticket reference shown to clients", () => {
    expect(qaReference(0)).toBe("UP-00000");
    expect(qaReference(7)).toBe("UP-00007");
    expect(qaReference(123456)).toBe("UP-123456");
  });

  it("keeps a closed ticket terminal and every target a real state", () => {
    expect(QA_STATUS_TRANSITIONS.closed).toEqual([]);
    expect(QA_STATUS_TRANSITIONS.resolved).toEqual(["closed", "in_progress"]);
    for (const targets of Object.values(QA_STATUS_TRANSITIONS))
      for (const target of targets)
        expect(QA_TICKET_STATUSES).toContain(target);
  });

  it("treats anything but resolved and closed as still needing an operator", () => {
    expect([...QA_OPEN_STATUSES].sort()).toEqual(
      ["in_progress", "new", "triaged", "waiting_client"].sort()
    );
    expect(QA_OVERDUE_AFTER_MINUTES).toBe(48 * 60);
  });

  it("defaults the optional evidence fields the browser cannot supply", () => {
    const parsed = qaEvidenceSchema.parse({
      capturedAt: "2026-10-09T08:00:00.000Z",
      route: "/dashboard",
      userAgent: "Mozilla/5.0",
      locale: "fr-FR",
      javaScriptErrors: [],
      failedRequests: [],
    });
    expect(parsed.viewport).toBeNull();
  });

  it("bounds the evidence a public form may post", () => {
    const error = {
      message: "x".repeat(301),
      source: "a.ts",
      at: "2026-10-09T08:00:00.000Z",
    };
    expect(
      qaEvidenceSchema.safeParse({
        capturedAt: "2026-10-09T08:00:00.000Z",
        route: "/dashboard",
        userAgent: "Mozilla/5.0",
        locale: "fr-FR",
        javaScriptErrors: [error],
        failedRequests: [],
      }).success
    ).toBe(false);
    expect(
      qaEvidenceSchema.safeParse({
        capturedAt: "2026-10-09T08:00:00.000Z",
        route: "/dashboard",
        userAgent: "Mozilla/5.0",
        locale: "fr-FR",
        javaScriptErrors: Array.from({ length: 11 }, () => ({
          message: "m",
          source: "a.ts",
          at: "2026-10-09T08:00:00.000Z",
        })),
        failedRequests: [],
      }).success
    ).toBe(false);
  });

  it("applies the intake defaults and keeps the honeypot present", () => {
    const parsed = qaTicketCreateSchema.parse({
      title: "Page de statut vide",
      clientMessage: "Ma page de statut n'affiche rien.",
    });
    expect(parsed.kind).toBe("bug");
    expect(parsed.steps).toBeNull();
    expect(parsed.statusSlug).toBeNull();
    expect(parsed.evidence).toBeNull();
    // The route answers a filled honeypot with a decoy token, so the field
    // always has to survive the parse.
    expect(parsed.website).toBe("");
  });

  it("refuses an unusable intake", () => {
    expect(
      qaTicketCreateSchema.safeParse({
        title: "abc",
        clientMessage: "Ma page de statut n'affiche rien.",
      }).success
    ).toBe(false);
    expect(
      qaTicketCreateSchema.safeParse({
        title: "Page de statut vide",
        clientMessage: "bug bug",
      }).success
    ).toBe(false);
    expect(
      qaTicketCreateSchema.safeParse({
        title: "Page de statut vide",
        clientMessage: "Ma page de statut n'affiche rien.",
        statusSlug: "../admin",
      }).success
    ).toBe(false);
  });

  it("publishes a note by default", () => {
    expect(
      qaTicketEventCreateSchema.parse({ body: "Nous reproduisons." }).visibility
    ).toBe("public");
    expect(qaTicketEventCreateSchema.safeParse({ body: "  " }).success).toBe(
      false
    );
  });

  it("only drafts the reply kinds the product implements", () => {
    expect(qaTicketReplyRequestSchema.parse({ kind: "resolution" }).kind).toBe(
      "resolution"
    );
    expect(
      qaTicketReplyRequestSchema.safeParse({ kind: "refund" }).success
    ).toBe(false);
  });

  it("requires the idle counter and the invariant wording", () => {
    expect(
      qaTicketSchema.safeParse({
        id: 1,
        source: "client",
        kind: "bug",
        severity: "P3",
        status: "new",
        title: "t",
        clientMessage: "c",
        steps: null,
        expected: null,
        actual: null,
        reporterName: null,
        reporterEmail: null,
        pageUrl: null,
        monitorId: null,
        monitorName: null,
        evidence: null,
        createdAt: "2026-10-09T08:00:00.000Z",
        updatedAt: "2026-10-09T08:00:00.000Z",
        resolvedAt: null,
      }).success
    ).toBe(false);
    expect(
      qaSelfTestResultSchema.safeParse({
        id: "scheduler_alive",
        label: "Ordonnanceur",
        ok: false,
        expected: "reprise en moins de 2 minutes",
        severity: "P1",
        ticketId: null,
      }).success
    ).toBe(false);
    expect(
      qaSelfTestResultSchema.safeParse({
        id: "scheduler_alive",
        label: "Ordonnanceur",
        ok: false,
        expected: "reprise en moins de 2 minutes",
        actual: "2 services hors invariant",
        severity: "P1",
        ticketId: 3,
      }).success
    ).toBe(true);
  });

  it("strips the reporter's private fields from the public ticket shape", () => {
    const parsed = qaPublicTicketSchema.parse({
      id: 3,
      title: "Page vide",
      kind: "bug",
      severity: "P3",
      status: "new",
      clientMessage: "Rien ne s'affiche.",
      steps: null,
      expected: null,
      actual: null,
      pageUrl: null,
      monitorName: null,
      createdAt: "2026-10-09T08:00:00.000Z",
      updatedAt: "2026-10-09T08:00:00.000Z",
      resolvedAt: null,
      reporterEmail: "camille@exemple.fr",
      reporterToken: "0123456789abcdef0123456789abcdef",
      fingerprint: "selftest:scheduler_alive:u1",
    });
    expect(parsed).not.toHaveProperty("reporterEmail");
    expect(parsed).not.toHaveProperty("reporterToken");
    expect(parsed).not.toHaveProperty("fingerprint");
  });
});

const validPlan = {
  slug: "pro",
  name: "Pro",
  maxMonitors: 25,
  minIntervalSeconds: 300,
  maxTimeoutMs: 30_000,
  maxChannels: 3,
  allowKeyword: true,
  priceCents: 900,
  trialDays: 14,
};

describe("plan and content contracts", () => {
  it("keeps the database enum and the wire enum on the same values", () => {
    // A classification the enum does not know is a rejected INSERT, which reads
    // as a lost check — the two lists must be edited together.
    expect([...checkClassificationValues]).toEqual([
      ...schemaClassificationValues,
    ]);
  });

  it("labels every classification and every keyword mode", () => {
    for (const value of checkClassificationValues)
      expect(checkClassificationLabels[value]).toBeTruthy();
    for (const value of monitorKeywordModeValues)
      expect(monitorKeywordModeLabels[value]).toBeTruthy();
  });

  it("never lets a plan promise an interval below the schema floor", () => {
    // The status-page percentile sample is sized from the 300 s floor; a plan
    // allowing 60 s would silently exceed that bound.
    expect(
      planUpsertSchema.safeParse({
        ...validPlan,
        minIntervalSeconds: 60,
      }).success
    ).toBe(false);
    expect(
      planUpsertSchema.safeParse({ ...validPlan, minIntervalSeconds: 300 })
        .success
    ).toBe(true);
  });

  it("applies plan defaults and refuses a malformed slug", () => {
    const parsed = planUpsertSchema.parse({
      ...validPlan,
      isPublic: undefined,
      sortOrder: undefined,
    });
    expect(parsed.isPublic).toBe(true);
    expect(parsed.sortOrder).toBe(0);
    expect(planSlugSchema.safeParse("Free Tier").success).toBe(false);
    expect(planSlugSchema.safeParse("free-tier_2").success).toBe(true);
    expect(planSlugSchema.safeParse("a").success).toBe(false);
  });

  it("describes the effective plan exactly as the server returns it", () => {
    // resolvePlan yields these nine fields and nothing else; an extra required
    // key here would make /api/plan fail its own contract.
    const parsed = planPublicSchema.parse({
      slug: "pro",
      name: "Pro",
      maxMonitors: 25,
      minIntervalSeconds: 300,
      maxTimeoutMs: 30_000,
      maxChannels: 3,
      allowKeyword: true,
      priceCents: 900,
      trialDays: 14,
    });
    expect(Object.keys(parsed).sort()).toEqual(
      [
        "allowKeyword",
        "maxChannels",
        "maxMonitors",
        "maxTimeoutMs",
        "minIntervalSeconds",
        "name",
        "priceCents",
        "slug",
        "trialDays",
      ].sort()
    );
  });

  it("keeps a monitor keyword optional and its mode defaulted", () => {
    const minimal = monitorCreateSchema.parse({
      name: "API",
      url: "https://exemple.fr",
    });
    expect(minimal.keyword ?? null).toBeNull();
    expect(minimal.keywordMode).toBe("must_contain");
    expect(
      monitorCreateSchema.safeParse({
        name: "API",
        url: "https://exemple.fr",
        keyword: "x".repeat(161),
      }).success
    ).toBe(false);
  });

  it("leaves an update field absent rather than defaulted", () => {
    // A PUT that only renames a monitor must not receive a reset interval,
    // timeout or keyword mode from the parser.
    const patch = monitorUpdateSchema.parse({ name: "Nouveau nom" });
    expect(patch.intervalSeconds).toBeUndefined();
    expect(patch.timeoutMs).toBeUndefined();
    expect(patch.keywordMode).toBeUndefined();
    expect(patch.keyword).toBeUndefined();
  });

  it("exposes the error codes the plan layer answers with", () => {
    expect(API_ERROR_CODES.FEATURE_UNAVAILABLE).toBe("FEATURE_UNAVAILABLE");
    expect(API_ERROR_CODES.CONFLICT).toBe("CONFLICT");
  });
});
