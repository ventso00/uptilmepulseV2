import { z } from "zod";
import { recordFailedRequest } from "./qaContext";
import {
  adminOverviewResponseSchema,
  authUserResponseSchema,
  channelsResponseSchema,
  dashboardResponseSchema,
  historyResponseSchema,
  incidentsResponseSchema,
  monitorCheckResponseSchema,
  monitorResponseSchema,
  myPlanResponseSchema,
  planAdminListResponseSchema,
  planListResponseSchema,
  planResponseSchema,
  publicStatusResponseSchema,
  qaDigestResponseSchema,
  qaOverviewResponseSchema,
  qaPublicTicketResponseSchema,
  qaSelfTestRunResponseSchema,
  qaTicketCreatedResponseSchema,
  qaTicketDetailResponseSchema,
  qaTicketReplyResponseSchema,
  qaTicketResponseSchema,
  qaTicketsResponseSchema,
  statusPageResponseSchema,
  type AdminOverview,
  type DashboardData,
  type HistoryLog,
  type Monitor,
  type MonitorIncident,
  type MyPlanResponse,
  type NotificationChannel,
  type PlanAdmin,
  type PlanPublic,
  type PlanUpsertInput,
  type PublicStatusData,
  type QaDigestResponse,
  type QaOverviewResponse,
  type QaPublicTicketResponse,
  type QaSelfTestRun,
  type QaTicket,
  type QaTicketDetailResponse,
  type QaTicketEvent,
  type QaTicketReplyResponse,
  type StatusPage,
  type User,
  type UserPlanAssignmentInput,
} from "@shared/contracts";

export type {
  AdminOverview,
  DashboardData,
  HistoryLog,
  Monitor,
  MonitorIncident,
  MyPlanResponse,
  NotificationChannel,
  PlanAdmin,
  PlanPublic,
  PublicStatusData,
  QaDigestResponse,
  QaOverviewResponse,
  QaPublicTicketResponse,
  QaSelfTestRun,
  QaTicket,
  QaTicketDetailResponse,
  QaTicketEvent,
  QaTicketReplyResponse,
  StatusPage,
  User,
};

export class ApiError extends Error {
  status?: number;
  code?: string;
  /** True when the payload did not match the shared contract. */
  contractMismatch = false;

  constructor(
    message: string,
    options: { status?: number; code?: string; contractMismatch?: boolean } = {}
  ) {
    super(message);
    this.name = "ApiError";
    this.status = options.status;
    this.code = options.code;
    this.contractMismatch = options.contractMismatch ?? false;
  }
}

/** Raised by a 401 so callers can redirect without inspecting status codes. */
export class UnauthorizedError extends ApiError {
  constructor(message = "Session expirée") {
    super(message, { status: 401, code: "UNAUTHORIZED" });
    this.name = "UnauthorizedError";
  }
}

function firstIssue(error: z.ZodError): string {
  const issue = error.issues[0];
  if (!issue) return "Réponse serveur invalide";
  const path = issue.path.join(".");
  return path
    ? `Réponse serveur invalide (${path})`
    : "Réponse serveur invalide";
}

/**
 * Every response is parsed against the shared zod contract. The previous
 * implementation used an unchecked `as T` cast, so a server-side shape change
 * surfaced as a silent `undefined` in the UI instead of a visible error.
 */
async function request<T>(
  path: string,
  schema: z.ZodType<T>,
  options: RequestInit = {}
): Promise<T> {
  const startedAt = performance.now();
  let response: Response;
  try {
    response = await fetch(path, {
      credentials: "include",
      headers: { "content-type": "application/json", ...options.headers },
      ...options,
    });
  } catch {
    recordFailedRequest(
      path,
      null,
      "NETWORK",
      Math.round(performance.now() - startedAt)
    );
    throw new ApiError("Connexion au serveur impossible", { code: "NETWORK" });
  }

  if (response.status === 204) return schema.parse({});

  const payload = (await response.json().catch(() => null)) as {
    error?: { code?: string; message?: string };
  } | null;

  if (!response.ok) {
    recordFailedRequest(
      path,
      response.status,
      payload?.error?.code ?? null,
      Math.round(performance.now() - startedAt)
    );
    if (response.status === 401) throw new UnauthorizedError();
    throw new ApiError(payload?.error?.message ?? "Une erreur est survenue", {
      status: response.status,
      code: payload?.error?.code,
    });
  }

  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    console.error("Contract mismatch", parsed.error.issues);
    // A contract mismatch is the failure mode the reporter cannot describe, so
    // it is captured as evidence with the field that broke.
    recordFailedRequest(
      path,
      response.status,
      "CONTRACT_MISMATCH",
      Math.round(performance.now() - startedAt)
    );
    throw new ApiError(firstIssue(parsed.error), {
      status: response.status,
      contractMismatch: true,
    });
  }
  return parsed.data;
}

/** Write endpoint with no meaningful response body. */
export const apiRequestUntyped = requestNoContent;

/**
 * For endpoints whose response body carries no data the UI reads (pause,
 * resume, delete, create). Errors are still raised with status and code, so
 * callers keep full control of failure handling.
 */
async function requestNoContent(
  path: string,
  options: RequestInit = {}
): Promise<void> {
  const startedAt = performance.now();
  let response: Response;
  try {
    response = await fetch(path, {
      credentials: "include",
      headers: { "content-type": "application/json", ...options.headers },
      ...options,
    });
  } catch {
    recordFailedRequest(
      path,
      null,
      "NETWORK",
      Math.round(performance.now() - startedAt)
    );
    throw new ApiError("Connexion au serveur impossible", { code: "NETWORK" });
  }
  if (response.ok) return;
  const payload = (await response.json().catch(() => null)) as {
    error?: { code?: string; message?: string };
  } | null;
  recordFailedRequest(
    path,
    response.status,
    payload?.error?.code ?? null,
    Math.round(performance.now() - startedAt)
  );
  if (response.status === 401) throw new UnauthorizedError();
  throw new ApiError(payload?.error?.message ?? "Une erreur est survenue", {
    status: response.status,
    code: payload?.error?.code,
  });
}

export const api = {
  me: () => request("/api/auth/me", authUserResponseSchema),
  login: (body: { email: string; password: string }) =>
    request("/api/auth/login", authUserResponseSchema, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  register: (body: { email: string; password: string }) =>
    request("/api/auth/register", authUserResponseSchema, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  logout: () => request("/api/auth/logout", z.unknown(), { method: "POST" }),
  dashboard: () => request("/api/dashboard", dashboardResponseSchema),
  monitor: (id: number) =>
    request(`/api/monitors/${id}`, monitorResponseSchema),
  history: (id: number, period: string, before?: number) => {
    const params = new URLSearchParams({ period });
    if (before) params.set("before", String(before));
    return request(
      `/api/monitors/${id}/history?${params.toString()}`,
      historyResponseSchema
    );
  },
  incidents: (id: number) =>
    request(`/api/monitors/${id}/incidents`, incidentsResponseSchema),
  runCheck: (id: number) =>
    request(`/api/monitors/${id}/check`, monitorCheckResponseSchema, {
      method: "POST",
    }),
  channels: () => request("/api/notification-channels", channelsResponseSchema),
  createChannel: (body: {
    type: "telegram";
    botToken: string;
    chatId: string;
  }) =>
    request("/api/notification-channels", z.object({ channel: z.unknown() }), {
      method: "POST",
      body: JSON.stringify(body),
    }),
  deleteChannel: (id: number) =>
    request(`/api/notification-channels/${id}`, z.unknown(), {
      method: "DELETE",
    }),
  testChannel: (id: number) =>
    request(
      `/api/notification-channels/${id}/test`,
      z.object({ success: z.boolean() }),
      {
        method: "POST",
      }
    ),
  statusPage: () => request("/api/status-page", statusPageResponseSchema),
  saveStatusPage: (body: {
    slug: string;
    title: string;
    description: string | null;
  }) =>
    request("/api/status-page", statusPageResponseSchema, {
      method: "PUT",
      body: JSON.stringify(body),
    }),
  deleteStatusPage: () =>
    apiRequestUntyped("/api/status-page", {
      method: "DELETE",
    }),
  // Served without authentication; the endpoint never answers 401, so sharing
  // the authenticated `request` helper is safe here.
  publicStatus: (slug: string) =>
    request(
      `/api/public/status/${encodeURIComponent(slug)}`,
      publicStatusResponseSchema
    ),

  /* ---------------- Quality & support ---------------- */

  /** Public intake. `website` is the honeypot: leave it empty. */
  reportIssue: (body: {
    title: string;
    clientMessage: string;
    kind: "bug" | "behaviour" | "ux";
    steps: string | null;
    expected: string | null;
    actual: string | null;
    reporterName: string | null;
    reporterEmail: string | null;
    pageUrl: string | null;
    statusSlug: string | null;
    evidence: unknown;
    website: string;
  }) =>
    request("/api/public/qa/tickets", qaTicketCreatedResponseSchema, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  publicTicket: (token: string) =>
    request(
      `/api/public/qa/tickets/${encodeURIComponent(token)}`,
      qaPublicTicketResponseSchema
    ),
  publicTicketMessage: (token: string, body: string) =>
    request(
      `/api/public/qa/tickets/${encodeURIComponent(token)}/messages`,
      qaPublicTicketResponseSchema,
      { method: "POST", body: JSON.stringify({ body, visibility: "public" }) }
    ),
  qaOverview: () => request("/api/qa/overview", qaOverviewResponseSchema),
  qaTickets: (filters: { status?: string; source?: string } = {}) => {
    const params = new URLSearchParams();
    if (filters.status) params.set("status", filters.status);
    if (filters.source) params.set("source", filters.source);
    const query = params.toString();
    return request(
      `/api/qa/tickets${query ? `?${query}` : ""}`,
      qaTicketsResponseSchema
    );
  },
  qaTicket: (id: number) =>
    request(`/api/qa/tickets/${id}`, qaTicketDetailResponseSchema),
  updateQaTicket: (
    id: number,
    body: {
      status?: string;
      severity?: string;
      kind?: string;
      title?: string;
    }
  ) =>
    request(`/api/qa/tickets/${id}`, qaTicketResponseSchema, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  addQaTicketEvent: (
    id: number,
    body: { body: string; visibility: "public" | "internal" }
  ) =>
    request(`/api/qa/tickets/${id}/events`, qaTicketDetailResponseSchema, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  qaTicketReply: (
    id: number,
    kind: "acknowledgement" | "clarification" | "resolution"
  ) =>
    request(`/api/qa/tickets/${id}/reply`, qaTicketReplyResponseSchema, {
      method: "POST",
      body: JSON.stringify({ kind }),
    }),
  runQaSelfTests: () =>
    request("/api/qa/self-tests/run", qaSelfTestRunResponseSchema, {
      method: "POST",
    }),
  runQaDigest: () =>
    request("/api/qa/digest/run", qaDigestResponseSchema, {
      method: "POST",
    }),
  qaDigest: () => request("/api/qa/digest", qaDigestResponseSchema),

  /* ---------------- Plans and creator console ---------------- */

  plans: () => request("/api/plans", planListResponseSchema),
  myPlan: () => request("/api/plan", myPlanResponseSchema),
  adminOverview: () =>
    request("/api/admin/overview", adminOverviewResponseSchema),
  adminPlans: () => request("/api/admin/plans", planAdminListResponseSchema),
  createPlan: (body: PlanUpsertInput) =>
    request("/api/admin/plans", planResponseSchema, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  updatePlan: (id: number, body: PlanUpsertInput) =>
    request(`/api/admin/plans/${id}`, planResponseSchema, {
      method: "PUT",
      body: JSON.stringify(body),
    }),
  assignUserPlan: (userId: number, body: UserPlanAssignmentInput) =>
    request(`/api/admin/users/${userId}/plan`, z.object({ ok: z.boolean() }), {
      method: "PUT",
      body: JSON.stringify(body),
    }),
};

export function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error) return error.message;
  return fallback;
}

export function formatRelativeDate(value: string | null): string {
  if (!value) return "Jamais";
  const date = new Date(value);
  const deltaMinutes = Math.round((Date.now() - date.getTime()) / 60_000);
  if (deltaMinutes < 1) return "à l’instant";
  if (deltaMinutes < 60) return `il y a ${deltaMinutes} min`;
  const deltaHours = Math.round(deltaMinutes / 60);
  if (deltaHours < 24) return `il y a ${deltaHours} h`;
  return new Intl.DateTimeFormat("fr-FR", {
    day: "2-digit",
    month: "short",
  }).format(date);
}

export function formatDuration(seconds: number | null): string {
  if (seconds === null) return "—";
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
}
