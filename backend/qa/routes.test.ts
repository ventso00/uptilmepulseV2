import { afterEach, describe, expect, it } from "vitest";
import type { Request } from "express";
import { requestOrigin } from "./routes";

/**
 * Follow-up links are embedded in generated documents and e-mailed around by
 * operators, so the origin they are built from must never come from a value an
 * attacker controls. `APP_BASE_URL` is authoritative; headers are a development
 * fallback only, and a `Host` header that does not look like a host is refused.
 */

function request(
  headers: Partial<Record<string, string | string[]>>,
  configured?: string
): string {
  const previous = process.env.APP_BASE_URL;
  if (configured === undefined) delete process.env.APP_BASE_URL;
  else process.env.APP_BASE_URL = configured;
  try {
    return requestOrigin({ headers } as unknown as Request);
  } finally {
    if (previous === undefined) delete process.env.APP_BASE_URL;
    else process.env.APP_BASE_URL = previous;
  }
}

afterEach(() => {
  delete process.env.APP_BASE_URL;
});

describe("requestOrigin", () => {
  it("prefers the configured base url and trims its trailing slash", () => {
    expect(
      request({ host: "attaquant.example" }, "https://uptimepulse.app/")
    ).toBe("https://uptimepulse.app");
  });

  it("trusts the proxy's forwarded host over the local one", () => {
    expect(
      request({
        host: "127.0.0.1:3000",
        "x-forwarded-host": "statut.exemple.fr",
        "x-forwarded-proto": "https",
      })
    ).toBe("https://statut.exemple.fr");
  });

  it("keeps an insecure forwarded protocol http", () => {
    expect(
      request({ host: "localhost:3000", "x-forwarded-proto": "http" })
    ).toBe("http://localhost:3000");
  });

  it("reads the first entry of a forwarded-host list", () => {
    expect(
      request({
        host: "localhost:3000",
        "x-forwarded-host": "a.exemple.fr,b.exemple.fr",
      })
    ).toBe("http://a.exemple.fr");
  });

  it("refuses a host that is not shaped like a host", () => {
    // Header injection: a smuggled newline would end up inside the Markdown
    // report and inside the reply pasted to the client.
    expect(request({ host: "evil.exemple\r\nX-Fake: 1" })).toBe("");
    expect(request({ host: "host with spaces" })).toBe("");
    expect(request({ host: "" })).toBe("");
    expect(request({})).toBe("");
  });

  it("accepts a bracketed IPv6 host and port", () => {
    expect(request({ host: "[::1]:3000" })).toBe("http://[::1]:3000");
  });
});
