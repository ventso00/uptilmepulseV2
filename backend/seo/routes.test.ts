import { describe, expect, it, vi } from "vitest";
import type { Request, Response } from "express";
import { requestOrigin } from "./routes";

function fakeReq(host?: string): Request {
  return {
    get: (name: string) => (name.toLowerCase() === "host" ? host : undefined),
    protocol: "https",
  } as unknown as Request;
}

function fakeRes() {
  const status = vi.fn(() => ({ json: vi.fn() }));
  return { req: { status } as unknown as Response, status };
}

describe("requestOrigin", () => {
  it("rebuilds the origin from the served domain, not a constant", () => {
    const res = fakeRes();
    expect(
      requestOrigin(fakeReq("uptimepulse-liard.vercel.app"), res.req)
    ).toBe("https://uptimepulse-liard.vercel.app");
    expect(res.status).not.toHaveBeenCalled();
  });

  it("accepts a host carrying a port, the local and container case", () => {
    const res = fakeRes();
    expect(requestOrigin(fakeReq("127.0.0.1:3123"), res.req)).toBe(
      "https://127.0.0.1:3123"
    );
    expect(requestOrigin(fakeReq("[::1]:3123"), res.req)).toBe(
      "https://[::1]:3123"
    );
    expect(res.status).not.toHaveBeenCalled();
  });

  it("rejects a forged Host that would publish a foreign domain in the sitemap", () => {
    const res = fakeRes();
    expect(
      requestOrigin(fakeReq("evil.test/..,/api/admin"), res.req)
    ).toBeNull();
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("rejects a missing Host", () => {
    const res = fakeRes();
    expect(requestOrigin(fakeReq(undefined), res.req)).toBeNull();
    expect(res.status).toHaveBeenCalledWith(400);
  });
});
