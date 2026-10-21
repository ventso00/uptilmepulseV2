import { afterEach, describe, expect, it, vi } from "vitest";

const sessionMock = vi.hoisted(() => ({ getApplicationUser: vi.fn() }));
vi.mock("../auth/session", () => sessionMock);

import type { Request, Response } from "express";
import { asyncHandler, requireAdmin, requireUser } from "./http";
import { OWNER_EMAIL } from "../auth/owner";

/**
 * `requireAdmin` is the only thing separating the creator console from any
 * signed-in account, and it answers through the response object rather than by
 * throwing — so the assertions are on the status and body it wrote.
 */
function fakeRes() {
  const res = {
    statusCode: 200,
    body: undefined as unknown,
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    json(payload: unknown) {
      res.body = payload;
      return res;
    },
    setHeader() {
      return res;
    },
  };
  return res as typeof res & Response;
}

afterEach(() => {
  sessionMock.getApplicationUser.mockReset();
});

describe("requireUser", () => {
  it("refuses an anonymous request with 401", async () => {
    sessionMock.getApplicationUser.mockResolvedValue(null);
    const res = fakeRes();
    expect(await requireUser({} as Request, res)).toBeNull();
    expect(res.statusCode).toBe(401);
    expect(res.body).toMatchObject({ error: { code: "UNAUTHORIZED" } });
  });

  it("refuses a signed-in account that is not the owner", async () => {
    // A session minted before the lock, or a hand-edited row, must stay useless.
    sessionMock.getApplicationUser.mockResolvedValue({
      id: 4,
      email: "ancienne@demo.dev",
      role: "admin",
    });
    const res = fakeRes();
    expect(await requireUser({} as Request, res)).toBeNull();
    expect(res.statusCode).toBe(403);
    expect(res.body).toMatchObject({ error: { code: "ACCESS_RESERVED" } });
  });

  it("accepts the owner address whatever its casing", async () => {
    sessionMock.getApplicationUser.mockResolvedValue({
      id: 5,
      email: `  ${OWNER_EMAIL.toUpperCase()}  `,
      role: "admin",
    });
    expect(await requireUser({} as Request, fakeRes())).toMatchObject({
      id: 5,
    });
  });

  it("reads the session once per request", async () => {
    sessionMock.getApplicationUser.mockResolvedValue({
      id: 3,
      email: OWNER_EMAIL,
      role: "admin",
    });
    const req = {} as Request;
    await requireUser(req, fakeRes());
    await requireUser(req, fakeRes());
    expect(sessionMock.getApplicationUser).toHaveBeenCalledTimes(1);
  });
});

describe("requireAdmin", () => {
  it("refuses a signed-in non-admin with 403", async () => {
    sessionMock.getApplicationUser.mockResolvedValue({
      id: 1,
      email: OWNER_EMAIL,
      role: "user",
    });
    const res = fakeRes();
    expect(await requireAdmin({} as Request, res)).toBeNull();
    expect(res.statusCode).toBe(403);
    expect(res.body).toMatchObject({ error: { code: "FORBIDDEN" } });
  });

  it("passes an administrator through", async () => {
    sessionMock.getApplicationUser.mockResolvedValue({
      id: 2,
      email: OWNER_EMAIL,
      role: "admin",
    });
    const res = fakeRes();
    expect(await requireAdmin({} as Request, res)).toMatchObject({ id: 2 });
    expect(res.body).toBeUndefined();
  });
});

describe("asyncHandler", () => {
  it("forwards a rejection to next instead of hanging the request", async () => {
    const failure = new Error("boom");
    const next = vi.fn();
    const handler = asyncHandler(async () => {
      throw failure;
    });
    handler({} as Request, {} as Response, next);
    await Promise.resolve();
    expect(next).toHaveBeenCalledWith(failure);
  });

  it("forwards a synchronous throw to next", () => {
    const failure = new Error("sync");
    const next = vi.fn();
    asyncHandler(() => {
      throw failure;
    })({} as Request, {} as Response, next);
    expect(next).toHaveBeenCalledWith(failure);
  });
});
