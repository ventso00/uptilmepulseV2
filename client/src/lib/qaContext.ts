import type { QaEvidence } from "@shared/contracts";

/**
 * Automatic capture context for a report: the reporter should never have to
 * transcribe what the browser already knows. Two ring buffers collect the
 * JavaScript errors and the failed API calls of the current session, and
 * `captureEvidence()` snapshots them together with the route, UA, locale and
 * viewport at the moment the reporter clicks "Signaler un problème".
 *
 * Deliberately small and non-persistent: it lives in module memory only, so a
 * report carries the current session and nothing that outlives the tab. Nothing
 * sensitive is stored — no token, no password, no response body.
 */

const MAX_ENTRIES = 10;
const MAX_TEXT = 300;

const javaScriptErrors: QaEvidence["javaScriptErrors"] = [];
const failedRequests: QaEvidence["failedRequests"] = [];

function clip(value: string, max = MAX_TEXT): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

/** Pushes oldest-first so the buffer keeps the most recent entries. */
function remember<T>(buffer: T[], entry: T): void {
  buffer.push(entry);
  if (buffer.length > MAX_ENTRIES) buffer.shift();
}

export function recordJavaScriptError(
  message: string,
  source = "inconnu",
  at = new Date().toISOString()
): void {
  remember(javaScriptErrors, {
    message: clip(message),
    source: clip(source),
    at,
  });
}

export function recordFailedRequest(
  path: string,
  status: number | null,
  code: string | null,
  durationMs: number | null,
  at = new Date().toISOString()
): void {
  remember(failedRequests, {
    path: clip(path),
    status,
    code: code === null ? null : clip(code, 60),
    durationMs,
    at,
  });
}

export function clearEvidence(): void {
  javaScriptErrors.length = 0;
  failedRequests.length = 0;
}

/**
 * Snapshot for a report. `route` is the visible path, not a secret: the query
 * string is dropped because session or invite tokens can live there.
 */
export function captureEvidence(
  now = new Date(),
  location: Location | undefined = typeof window === "undefined"
    ? undefined
    : window.location
): QaEvidence {
  return {
    capturedAt: now.toISOString(),
    route: location ? location.pathname : "/",
    userAgent:
      typeof navigator === "undefined" ? "inconnu" : navigator.userAgent,
    locale:
      typeof navigator === "undefined"
        ? "inconnu"
        : (navigator.language ?? "inconnu"),
    viewport:
      typeof window === "undefined" ||
      window.innerWidth === 0 ||
      window.innerHeight === 0
        ? null
        : { width: window.innerWidth, height: window.innerHeight },
    javaScriptErrors: [...javaScriptErrors],
    failedRequests: [...failedRequests],
  };
}

/**
 * Installs the window-level listeners. Called once from the entry point: a
 * second call would double-record every error.
 */
let installed = false;

export function installEvidenceCapture(): void {
  if (installed || typeof window === "undefined") return;
  installed = true;

  window.addEventListener("error", event => {
    const source = event.filename
      ? `${event.filename}:${event.lineno ?? 0}`
      : "inconnu";
    recordJavaScriptError(event.message ?? "Erreur inconnue", source);
  });

  window.addEventListener("unhandledrejection", event => {
    const reason = event.reason;
    const message =
      reason instanceof Error
        ? `${reason.name}: ${reason.message}`
        : typeof reason === "string"
          ? reason
          : "Requête Promise rejetée sans message";
    recordJavaScriptError(message, "rejection non gérée");
  });
}
