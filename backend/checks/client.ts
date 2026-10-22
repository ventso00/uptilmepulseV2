import dns from "node:dns";
import http from "node:http";
import https from "node:https";
import { performance } from "node:perf_hooks";
import type { Socket } from "node:net";
import type { TLSSocket } from "node:tls";
import type { CheckClassification } from "@shared/db/schema";
import {
  resolveAndValidateTarget,
  TargetValidationError,
  validateResolvedAddresses,
  validateUrlSyntax,
} from "../monitors/ssrf";

const MAX_RESPONSE_BYTES = 256 * 1024;
const MAX_REDIRECTS = 3;
const USER_AGENT = "UptimePulse-Monitor/1.0";

/** Network-phase timings of the final hop, in ms (null when the phase was skipped). */
export type CheckPhases = {
  dnsMs: number | null;
  tcpMs: number | null;
  tlsMs: number | null;
  ttfbMs: number | null;
};

export type PeerCertificateInfo = {
  issuer: string;
  subject: string;
  validTo: string | null;
};

export type HttpCheckResult = {
  statusCode: number | null;
  responseTimeMs: number | null;
  isUp: boolean;
  classification: CheckClassification;
  errorMessage: string | null;
  phases: CheckPhases | null;
  certificate: PeerCertificateInfo | null;
};

type ResponseResult = {
  statusCode: number;
  location: string | undefined;
  responseTimeMs: number;
  phases: CheckPhases;
  certificate: PeerCertificateInfo | null;
  /** First `MAX_RESPONSE_BYTES` of the body, decoded as UTF-8. */
  body: string;
  /** True when the body was cut short, so an absent keyword proves nothing. */
  truncated: boolean;
  contentType: string;
};

/** Content assertion asked of a check, already validated against the plan. */
export type ContentExpectation = {
  keyword: string;
  mustContain: boolean;
};

export type ContentOutcome = {
  verdict: "pass" | "fail" | "unknown";
  classification: CheckClassification | null;
  errorMessage: string | null;
};

/**
 * Keyword matching is case-insensitive on the raw decoded body.
 *
 * A `must_contain` that misses on a truncated body is reported as `unknown`,
 * not as a failure: the text may simply sit past the read cap, and turning that
 * into an incident is the false-outage class this module already refuses for
 * large pages. `must_not_contain` needs no such mercy — finding the string is
 * proof on its own.
 */
export function evaluateContent(
  expectation: ContentExpectation,
  body: string,
  truncated: boolean,
  contentType: string
): ContentOutcome {
  const keyword = expectation.keyword.toLowerCase();
  if (!/text|json|xml|html|javascript/i.test(contentType)) {
    return {
      verdict: "unknown",
      classification: null,
      errorMessage: `Contenu non inspecté : type « ${contentType.slice(0, 60)} »`,
    };
  }
  const found = body.toLowerCase().includes(keyword);
  if (expectation.mustContain) {
    if (found)
      return { verdict: "pass", classification: null, errorMessage: null };
    if (truncated)
      return {
        verdict: "unknown",
        classification: null,
        errorMessage: `Mot-clé introuvable dans les 256 premiers Ko : absence non concluante`,
      };
    return {
      verdict: "fail",
      classification: "DOWN_KEYWORD_MISSING",
      errorMessage: `Mot-clé absent : « ${expectation.keyword.slice(0, 120)} »`,
    };
  }
  if (found) {
    return {
      verdict: "fail",
      classification: "DOWN_KEYWORD_PRESENT",
      errorMessage: `Contenu interdit présent : « ${expectation.keyword.slice(0, 120)} »`,
    };
  }
  return { verdict: "pass", classification: null, errorMessage: null };
}

function classifyHttpStatus(statusCode: number): CheckClassification {
  if (statusCode >= 200 && statusCode < 300) return "UP_HTTP_2XX";
  if (statusCode >= 300 && statusCode < 400) return "UP_HTTP_3XX";
  if (statusCode >= 400 && statusCode < 500) return "DOWN_HTTP_4XX";
  return "DOWN_HTTP_5XX";
}

function errorClassification(error: unknown): CheckClassification {
  if (error instanceof TargetValidationError)
    return error.resolutionFailed ? "DOWN_DNS" : error.code;
  const code =
    typeof error === "object" && error && "code" in error
      ? String(error.code)
      : "";
  const message = error instanceof Error ? error.message : String(error);
  if (
    code === "UPTIMEPULSE_TIMEOUT" ||
    code === "ETIMEDOUT" ||
    message.includes("timeout")
  )
    return "DOWN_TIMEOUT";
  if (["ENOTFOUND", "EAI_AGAIN", "EAI_FAIL", "ENODATA"].includes(code))
    return "DOWN_DNS";
  if (
    code.includes("CERT") ||
    code.includes("TLS") ||
    message.toLowerCase().includes("certificate")
  )
    return "DOWN_TLS";
  return "DOWN_NETWORK";
}

function safeErrorMessage(error: unknown): string {
  const message =
    error instanceof Error ? error.message : "Network check failed";
  return message.replace(/[\r\n]+/g, " ").slice(0, 300);
}

function distinguishedName(entry: {
  CN?: string;
  O?: string;
  OU?: string;
}): string {
  return entry.CN ?? entry.O ?? entry.OU ?? "Inconnu";
}

/**
 * Peer certificate of the TLS socket that served this request. Captured right
 * after `secureConnect`, before the socket can be torn down.
 */
function readPeerCertificate(
  socket: Socket | null | undefined
): PeerCertificateInfo | null {
  const tlsSocket = socket as TLSSocket | undefined;
  if (!tlsSocket || typeof tlsSocket.getPeerCertificate !== "function")
    return null;
  try {
    const cert = tlsSocket.getPeerCertificate();
    if (!cert || Object.keys(cert).length === 0) return null;
    const parsed = cert.valid_to ? Date.parse(cert.valid_to) : NaN;
    return {
      issuer: distinguishedName(cert.issuer).slice(0, 255),
      subject: distinguishedName(cert.subject).slice(0, 255),
      validTo: Number.isNaN(parsed) ? null : new Date(parsed).toISOString(),
    };
  } catch {
    return null;
  }
}

function requestOnce(url: URL, timeoutMs: number): Promise<ResponseResult> {
  return new Promise((resolve, reject) => {
    const transport = url.protocol === "https:" ? https : http;
    const startedAt = performance.now();
    const hostname = url.hostname.replace(/^\[|\]$/g, "");
    let settled = false;
    const marker = {
      lookupStart: null,
      lookup: null,
      connect: null,
      secure: null,
      headers: null,
    } as {
      lookupStart: number | null;
      lookup: number | null;
      connect: number | null;
      secure: number | null;
      headers: number | null;
    };
    let certificate: PeerCertificateInfo | null = null;
    const finishError = (error: unknown) => {
      if (settled) return;
      settled = true;
      reject(error);
    };

    const request = transport.request(
      {
        protocol: url.protocol,
        hostname,
        port: url.port || undefined,
        path: `${url.pathname || "/"}${url.search}`,
        method: "GET",
        headers: { "User-Agent": USER_AGENT, Accept: "*/*" },
        timeout: timeoutMs,
        /**
         * A fresh connection per hop. The shared keep-alive agents reuse
         * sockets, which skips `lookup`/`connect`/`secureConnect` entirely —
         * the phase timings would be missing on most checks.
         */
        agent: false,
        /**
         * Re-resolves the hostname and re-validates every returned address, so a
         * DNS rebind between validation and connection cannot reach a private
         * range.
         *
         * Node calls this with `all: true` (see the observed
         * `{"hints":0,"all":true}` options), which means the callback MUST
         * receive an array. Returning a bare string here made every check fail
         * with ERR_INVALID_IP_ADDRESS.
         */
        lookup: (
          lookupHostname: string,
          lookupOptions: dns.LookupOptions,
          callback: (
            error: NodeJS.ErrnoException | null,
            address: string | Array<{ address: string; family: number }>,
            family?: number
          ) => void
        ) => {
          const wantsAll = lookupOptions?.all === true;
          marker.lookupStart = performance.now();
          dns.lookup(
            lookupHostname,
            { all: true, verbatim: true },
            (error, addresses) => {
              marker.lookup = performance.now();
              if (error)
                return callback(
                  error,
                  wantsAll ? [] : "",
                  wantsAll ? undefined : 0
                );
              try {
                validateResolvedAddresses(
                  addresses.map(entry => entry.address)
                );
                if (addresses.length === 0) {
                  const empty = Object.assign(
                    new Error("Target did not resolve"),
                    {
                      code: "ENOTFOUND",
                    }
                  );
                  return callback(
                    empty,
                    wantsAll ? [] : "",
                    wantsAll ? undefined : 0
                  );
                }
                if (wantsAll)
                  return callback(
                    null,
                    addresses.map(entry => ({
                      address: entry.address,
                      family: entry.family,
                    }))
                  );
                const selected = addresses[0] as {
                  address: string;
                  family: number;
                };
                return callback(null, selected.address, selected.family);
              } catch (validationError) {
                const blocked = Object.assign(
                  new Error("Resolved target is blocked"),
                  {
                    code:
                      validationError instanceof TargetValidationError
                        ? validationError.code
                        : "BLOCKED_TARGET",
                  }
                );
                return callback(
                  blocked,
                  wantsAll ? [] : "",
                  wantsAll ? undefined : 0
                );
              }
            }
          );
        },
      },
      response => {
        marker.headers = performance.now();
        const finish = () => {
          if (settled) return;
          settled = true;
          certificate ??= readPeerCertificate(request.socket);
          const elapsed = (from: number, to: number | null) =>
            to === null ? null : Math.max(0, Math.round(to - from));
          resolve({
            statusCode: response.statusCode ?? 0,
            location:
              typeof response.headers.location === "string"
                ? response.headers.location
                : undefined,
            responseTimeMs: Math.max(
              0,
              Math.round(performance.now() - startedAt)
            ),
            phases: {
              dnsMs: elapsed(marker.lookupStart ?? startedAt, marker.lookup),
              tcpMs:
                marker.connect === null
                  ? null
                  : elapsed(
                      marker.lookup ?? marker.lookupStart ?? startedAt,
                      marker.connect
                    ),
              tlsMs:
                marker.secure === null
                  ? null
                  : elapsed(marker.connect ?? startedAt, marker.secure),
              ttfbMs: elapsed(startedAt, marker.headers),
            },
            certificate,
            body: Buffer.concat(chunks).toString("utf8"),
            truncated,
            contentType: String(response.headers["content-type"] ?? ""),
          });
        };
        let bytes = 0;
        let truncated = false;
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => {
          bytes += chunk.length;
          if (!truncated) chunks.push(chunk);
          /**
           * The body is drained only to bound memory. Status and headers have
           * already proven the service answers, so a page larger than the cap
           * must stop the read rather than open an incident — otherwise every
           * heavy home page (streaming, SPA) reads as a false outage.
           */
          if (bytes > MAX_RESPONSE_BYTES) {
            truncated = true;
            response.destroy();
            finish();
          }
        });
        response.on("error", finishError);
        response.on("end", finish);
      }
    );

    /**
     * Node does not emit `lookup`/`connect`/`secureConnect` on the request
     * when a custom `lookup` is supplied, so the phases are timed on the
     * socket itself: the `socket` event fires while the connection is still
     * pending, which makes the listener ordering reliable.
     */
    request.on("socket", socket => {
      socket.once("connect", () => {
        if (marker.connect === null) marker.connect = performance.now();
      });
      // `authorized` is false (not undefined) before the handshake, so the
      // only safe signal is the event itself; a fallback read happens at
      // resolve time for the rare already-secure socket.
      const tlsSocket = socket as TLSSocket;
      if (typeof tlsSocket.getPeerCertificate !== "function") return;
      tlsSocket.once("secureConnect", () => {
        marker.secure = performance.now();
        certificate = readPeerCertificate(socket);
      });
    });
    request.on("timeout", () => {
      request.destroy(
        Object.assign(new Error("Request timeout"), {
          code: "UPTIMEPULSE_TIMEOUT",
        })
      );
    });
    request.on("error", finishError);
    request.end();
  });
}

export async function performHttpCheck(
  rawUrl: string,
  timeoutMs: number,
  expectation?: ContentExpectation | null
): Promise<HttpCheckResult> {
  let currentUrl: URL;
  try {
    currentUrl = validateUrlSyntax(rawUrl);
    for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect += 1) {
      await resolveAndValidateTarget(currentUrl.toString());
      const response = await requestOnce(currentUrl, timeoutMs);
      const classification = classifyHttpStatus(response.statusCode);
      if (
        response.statusCode >= 300 &&
        response.statusCode < 400 &&
        response.location
      ) {
        if (redirect === MAX_REDIRECTS) {
          return {
            statusCode: response.statusCode,
            responseTimeMs: response.responseTimeMs,
            isUp: false,
            classification: "DOWN_NETWORK",
            errorMessage: "Redirect limit exceeded",
            phases: response.phases,
            certificate: response.certificate,
          };
        }
        try {
          currentUrl = validateUrlSyntax(
            new URL(response.location, currentUrl).toString()
          );
        } catch (error) {
          return {
            statusCode: response.statusCode,
            responseTimeMs: response.responseTimeMs,
            isUp: false,
            classification: errorClassification(error),
            errorMessage: safeErrorMessage(error),
            phases: response.phases,
            certificate: response.certificate,
          };
        }
        continue;
      }
      const httpSucceeded =
        response.statusCode >= 200 && response.statusCode < 400;
      if (httpSucceeded && expectation) {
        const outcome = evaluateContent(
          expectation,
          response.body,
          response.truncated,
          response.contentType
        );
        if (outcome.verdict === "fail") {
          return {
            statusCode: response.statusCode,
            responseTimeMs: response.responseTimeMs,
            isUp: false,
            classification: outcome.classification ?? "DOWN_KEYWORD_MISSING",
            errorMessage: outcome.errorMessage,
            phases: response.phases,
            certificate: response.certificate,
          };
        }
        // `pass` and `unknown` both keep the monitor UP; `unknown` records why
        // the content could not be concluded from what was read.
        return {
          statusCode: response.statusCode,
          responseTimeMs: response.responseTimeMs,
          isUp: true,
          classification,
          errorMessage: outcome.errorMessage,
          phases: response.phases,
          certificate: response.certificate,
        };
      }
      return {
        statusCode: response.statusCode,
        responseTimeMs: response.responseTimeMs,
        isUp: httpSucceeded,
        classification,
        errorMessage:
          response.statusCode >= 400 ? `HTTP ${response.statusCode}` : null,
        phases: response.phases,
        certificate: response.certificate,
      };
    }
    return {
      statusCode: null,
      responseTimeMs: null,
      isUp: false,
      classification: "DOWN_NETWORK",
      errorMessage: "Redirect limit exceeded",
      phases: null,
      certificate: null,
    };
  } catch (error) {
    return {
      statusCode: null,
      responseTimeMs: null,
      isUp: false,
      classification: errorClassification(error),
      errorMessage: safeErrorMessage(error),
      phases: null,
      certificate: null,
    };
  }
}
