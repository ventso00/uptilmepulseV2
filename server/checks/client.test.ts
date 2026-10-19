import { describe, expect, it, afterEach } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { validateResolvedAddresses } from "../monitors/ssrf";
import { performHttpCheck } from "./client";

/**
 * Regression cover for the `lookup` hook contract.
 *
 * Node invokes a custom `lookup` with `{all: true}`, which requires the
 * callback to receive an array of `{address, family}`. The previous
 * implementation returned a bare string, so every single check failed with
 * ERR_INVALID_IP_ADDRESS and no test caught it because the probe used a private
 * address that the SSRF guard blocks by design.
 */

const servers: http.Server[] = [];

afterEach(async () => {
  await Promise.all(
    servers
      .splice(0)
      .map(
        server => new Promise<void>(resolve => server.close(() => resolve()))
      )
  );
});

async function startServer(
  handler: http.RequestListener
): Promise<{ url: string; port: number }> {
  const server = http.createServer(handler);
  servers.push(server);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return { url: `http://127.0.0.1:${port}/`, port };
}

describe("validateResolvedAddresses", () => {
  it("rejects an empty resolution", () => {
    expect(() => validateResolvedAddresses([])).toThrow();
  });

  it("rejects private and loopback results", () => {
    for (const address of [
      "127.0.0.1",
      "10.1.2.3",
      "192.168.1.1",
      "169.254.169.254",
    ]) {
      expect(() => validateResolvedAddresses([address])).toThrow();
    }
  });

  it("accepts a public address", () => {
    expect(() => validateResolvedAddresses(["93.184.216.34"])).not.toThrow();
  });
});

describe("performHttpCheck", () => {
  it("resolves a public hostname and reports a 2xx as up", async () => {
    const result = await performHttpCheck("https://example.com", 10_000);
    // The exact status is not asserted, only that a reachable public host is
    // classified as up rather than failing in the DNS hook.
    expect(result.classification).toBe("UP_HTTP_2XX");
    expect(result.isUp).toBe(true);
    expect(result.statusCode).toBe(200);
    expect(result.responseTimeMs).toBeGreaterThan(0);
    expect(result.errorMessage).toBeNull();
  }, 20_000);

  it("measures every network phase and reads the peer certificate on HTTPS", async () => {
    const result = await performHttpCheck("https://example.com", 10_000);
    // agent:false forces a fresh connection, so lookup/connect/secureConnect
    // all fire; anything missing here means the timing events regressed.
    expect(result.phases).not.toBeNull();
    expect(result.phases?.dnsMs).toBeGreaterThanOrEqual(0);
    expect(result.phases?.tcpMs).toBeGreaterThanOrEqual(0);
    expect(result.phases?.tlsMs).toBeGreaterThanOrEqual(0);
    expect(result.phases?.ttfbMs).not.toBeNull();
    expect(result.certificate).not.toBeNull();
    expect(result.certificate?.issuer.length).toBeGreaterThan(0);
    expect(result.certificate?.subject.length).toBeGreaterThan(0);
    if (result.certificate?.validTo)
      expect(new Date(result.certificate.validTo).getTime()).toBeGreaterThan(
        Date.now()
      );
  }, 20_000);

  it("treats a body larger than the read cap as up, not as an incident", async () => {
    // Real regression: spotify's home page streams more than MAX_RESPONSE_BYTES
    // (256 KiB). The cap bounds memory only — the status line and headers were
    // already received, so the service is up.
    const result = await performHttpCheck("https://open.spotify.com/", 15_000);
    expect(result.isUp).toBe(true);
    expect(result.classification).toMatch(/^UP_HTTP_/);
    expect(result.errorMessage).toBeNull();
    expect(result.phases?.ttfbMs).not.toBeNull();
  }, 30_000);

  it("classifies a blocked private target instead of throwing", async () => {
    const { url } = await startServer((_req, res) => res.end("ok"));
    const result = await performHttpCheck(url, 5000);
    // The request is refused by the SSRF guard, which is the intended
    // behaviour for a loopback target.
    expect(result.isUp).toBe(false);
    expect(["BLOCKED_TARGET", "INVALID_TARGET"]).toContain(
      result.classification
    );
  });

  it("refuses a host that does not resolve, without throwing", async () => {
    const result = await performHttpCheck(
      "https://uptimepulse-nonexistent-host.invalid",
      5000
    );
    // resolveAndValidateTarget rejects the target during the pre-flight DNS
    // check, so the failure is surfaced as an invalid target rather than a
    // socket-level DNS error.
    expect(result.isUp).toBe(false);
    expect(result.classification).toBe("INVALID_TARGET");
    expect(result.statusCode).toBeNull();
    expect(result.phases).toBeNull();
    expect(result.certificate).toBeNull();
  }, 20_000);

  it("rejects a non-HTTP protocol before any socket is opened", async () => {
    const result = await performHttpCheck("file:///etc/passwd", 5000);
    expect(result.isUp).toBe(false);
    expect(result.classification).toBe("INVALID_TARGET");
  });
});
