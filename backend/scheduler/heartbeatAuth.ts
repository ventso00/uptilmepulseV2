import { jwtVerify } from "jose";
import type { Request } from "express";
import { ENV } from "../_core/env";
import { parse } from "cookie";

/**
 * The platform heartbeat calls back with a cron_ session cookie; only that
 * identity may trigger a batch tick over HTTP.
 */
export async function verifyHeartbeatRequest(req: Request): Promise<boolean> {
  const raw = parse(req.headers.cookie ?? "").app_session_id;
  if (!raw || !ENV.cookieSecret || !ENV.appId) return false;
  try {
    const { payload } = await jwtVerify(
      raw,
      new TextEncoder().encode(ENV.cookieSecret),
      { algorithms: ["HS256"] }
    );
    return (
      payload.appId === ENV.appId &&
      typeof payload.openId === "string" &&
      payload.openId.startsWith("cron_")
    );
  } catch {
    return false;
  }
}
