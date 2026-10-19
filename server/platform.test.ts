import { afterEach, describe, expect, it, vi } from "vitest";
import {
  publicPlatformConfig,
  publicPlatformScript,
} from "./_core/publicConfig";
import { getSessionCookieOptions } from "./_core/cookies";
import { asyncHandler, parseId, errorHandler } from "./_core/http";
import { sdk } from "./_core/sdk";
import { APP_SESSION_COOKIE, SESSION_TTL_MS } from "./auth/session";
import { COOKIE_NAME } from "../shared/const";
import type { Request, Response } from "express";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("platform integration", () => {
  it("exposes only named public runtime configuration", () => {
    const env = {
      MANUS_PROJECT_ID: "project-test",
      MANUS_API_KEY: "server-only-test",
      MANUS_JWT_SECRET: "signing-only-test",
      DATABASE_URL: "db-only-test",
      MANUS_API_BROWSER_KEY: "public-browser-test",
      MANUS_ANALYTICS_ENDPOINT: "https://analytics.example",
      MANUS_ANALYTICS_WEBSITE_ID: "site-test",
    };
    expect(publicPlatformConfig(env)).toMatchObject({
      projectId: "project-test",
      apiBrowserKey: "public-browser-test",
    });
    const script = publicPlatformScript(env);
    for (const value of [
      env.MANUS_API_KEY,
      env.MANUS_JWT_SECRET,
      env.DATABASE_URL,
    ]) {
      expect(script).not.toContain(value);
    }
  });

  it("uses a distinct secure app cookie behind the HTTPS Preview proxy", () => {
    expect(COOKIE_NAME).not.toBe("app_session_id");
    expect(
      getSessionCookieOptions({ protocol: "http", headers: {} } as never)
    ).toMatchObject({ secure: true, httpOnly: true, sameSite: "none" });
  });

  it("keeps the application session cookie separate from the platform one", () => {
    expect(APP_SESSION_COOKIE).not.toBe(COOKIE_NAME);
    expect(SESSION_TTL_MS).toBe(1000 * 60 * 60 * 24 * 30);
  });

  it("binds signed app sessions to this project", async () => {
    vi.stubEnv("MANUS_PROJECT_ID", "project-test");
    vi.stubEnv("MANUS_JWT_SECRET", "unit-test-signing-key-never-deployed");
    const token = await sdk.signSession({
      openId: "user-test",
      appId: "project-test",
      name: "",
    });
    expect(await sdk.verifySession(token)).toMatchObject({
      openId: "user-test",
    });
    vi.stubEnv("MANUS_PROJECT_ID", "different-project");
    expect(await sdk.verifySession(token)).toBeNull();
  });
});

describe("http helpers", () => {
  it("forwards a rejected async handler to the error pipeline", async () => {
    // Express 4 does not do this on its own; without the wrapper the request
    // would hang until the gateway timed out.
    const next = vi.fn();
    const handler = asyncHandler(async () => {
      throw new Error("database exploded");
    });
    handler({} as Request, {} as Response, next);
    await new Promise(resolve => setImmediate(resolve));
    expect(next).toHaveBeenCalledOnce();
    expect((next.mock.calls[0][0] as Error).message).toBe("database exploded");
  });

  it("forwards a synchronous throw to the error pipeline", () => {
    const next = vi.fn();
    const handler = asyncHandler(() => {
      throw new Error("bad target");
    });
    handler({} as Request, {} as Response, next);
    expect(next).toHaveBeenCalledOnce();
  });

  it("parses only positive integer ids", () => {
    expect(parseId("12")).toBe(12);
    expect(parseId("0")).toBeNull();
    expect(parseId("-3")).toBeNull();
    expect(parseId("1.5")).toBeNull();
    expect(parseId("abc")).toBeNull();
    expect(parseId("")).toBeNull();
  });

  it("maps database connectivity failures to 503 and hides internals", () => {
    const headers: Record<string, string> = {};
    const json = vi.fn();
    const status = vi.fn(() => ({
      setHeader: (k: string, v: string) => {
        headers[k] = v;
      },
      json,
    }));
    const res = { headersSent: false, status } as unknown as Response;

    errorHandler(
      Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:3306"), {
        code: "ECONNREFUSED",
      }),
      { method: "GET", originalUrl: "/api/dashboard" } as Request,
      res,
      vi.fn()
    );

    expect(status).toHaveBeenCalledWith(503);
    const body = json.mock.calls[0][0] as {
      error: { code: string; message: string };
    };
    expect(body.error.code).toBe("DATABASE_UNAVAILABLE");
    // The driver message must not leak to the client.
    expect(JSON.stringify(body)).not.toContain("ECONNREFUSED");
  });

  it("keeps the SQL text out of the log when the driver fails behind Drizzle", () => {
    const json = vi.fn();
    const status = vi.fn(() => ({ json }));
    const logged = vi.fn();
    const spy = vi.spyOn(console, "error").mockImplementation(logged);
    const driverError = Object.assign(
      new Error("connect ECONNREFUSED 127.0.0.1:3306"),
      { code: "ECONNREFUSED" }
    );
    // Shape thrown by drizzle 0.44: the code sits on `cause`, the message is SQL.
    const sql = "insert into `users` (`password_hash`) values ('secret-hash')";
    const wrapped = Object.assign(
      new Error(`Failed query: ${sql}\nparams: x`),
      {
        query: sql,
        cause: driverError,
      }
    );

    errorHandler(
      wrapped,
      { method: "POST", originalUrl: "/api/auth/register" } as Request,
      { headersSent: false, status } as unknown as Response,
      vi.fn()
    );

    expect(status).toHaveBeenCalledWith(503);
    expect(JSON.stringify(json.mock.calls[0][0])).not.toContain("secret-hash");
    const line = logged.mock.calls[0][0] as string;
    expect(JSON.parse(line)).toMatchObject({
      event: "database_error",
      code: "ECONNREFUSED",
    });
    expect(line).not.toContain("insert into");
    spy.mockRestore();
  });

  it("returns a generic 500 for unexpected failures", () => {
    const json = vi.fn();
    const status = vi.fn(() => ({ json }));
    errorHandler(
      new Error("null pointer at secret.js:42"),
      { method: "GET", originalUrl: "/api/monitors" } as Request,
      { headersSent: false, status } as unknown as Response,
      vi.fn()
    );
    expect(status).toHaveBeenCalledWith(500);
    expect(JSON.stringify(json.mock.calls[0][0])).not.toContain("secret.js");
  });

  it("maps an oversized body to 413 instead of 500", () => {
    const json = vi.fn();
    const status = vi.fn(() => ({ json }));
    errorHandler(
      Object.assign(new Error("request entity too large"), {
        type: "entity.too.large",
        status: 413,
      }),
      { method: "POST", originalUrl: "/api/monitors" } as Request,
      { headersSent: false, status } as unknown as Response,
      vi.fn()
    );
    expect(status).toHaveBeenCalledWith(413);
    expect(
      (json.mock.calls[0][0] as { error: { code: string } }).error.code
    ).toBe("PAYLOAD_TOO_LARGE");
  });

  it("maps a malformed body to 400", () => {
    const json = vi.fn();
    const status = vi.fn(() => ({ json }));
    errorHandler(
      Object.assign(new Error("Unexpected token }"), {
        type: "entity.parse.failed",
        status: 400,
      }),
      { method: "POST", originalUrl: "/api/monitors" } as Request,
      { headersSent: false, status } as unknown as Response,
      vi.fn()
    );
    expect(status).toHaveBeenCalledWith(400);
  });

  it("defers to express when the response already started", () => {
    const next = vi.fn();
    errorHandler(
      new Error("late failure"),
      { method: "GET", originalUrl: "/api/dashboard" } as Request,
      { headersSent: true } as unknown as Response,
      next
    );
    expect(next).toHaveBeenCalledOnce();
  });
});
