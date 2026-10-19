import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt, isNull } from "drizzle-orm";
import { parse } from "cookie";
import type { Request, Response } from "express";
import { sessions, users, type User } from "@shared/db/schema";
import { getDb } from "../db";

export const APP_SESSION_COOKIE = "uptimepulse_session";
export const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30;

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function setSessionCookie(res: Response, token: string): void {
  res.cookie(APP_SESSION_COOKIE, token, {
    httpOnly: true,
    secure: true,
    sameSite: "none",
    path: "/",
    maxAge: SESSION_TTL_MS,
  });
}

export async function createSession(
  userId: number,
  res: Response
): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database is not available");

  const token = randomBytes(32).toString("base64url");
  await db.insert(sessions).values({
    tokenHash: hashToken(token),
    userId,
    expiresAt: new Date(Date.now() + SESSION_TTL_MS),
  });
  setSessionCookie(res, token);
}

export async function getSessionToken(req: Request): Promise<string | null> {
  const cookies = parse(req.headers.cookie ?? "");
  return cookies[APP_SESSION_COOKIE] ?? null;
}

export async function getApplicationUser(req: Request): Promise<User | null> {
  const token = await getSessionToken(req);
  if (!token) return null;

  const db = await getDb();
  if (!db) return null;

  const result = await db
    .select({ user: users })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(
      and(
        eq(sessions.tokenHash, hashToken(token)),
        isNull(sessions.revokedAt),
        gt(sessions.expiresAt, new Date())
      )
    )
    .limit(1);

  return result[0]?.user ?? null;
}

export async function revokeSession(
  req: Request,
  res: Response
): Promise<void> {
  const token = await getSessionToken(req);
  const db = await getDb();
  if (token && db) {
    await db
      .update(sessions)
      .set({ revokedAt: new Date() })
      .where(eq(sessions.tokenHash, hashToken(token)));
  }
  res.clearCookie(APP_SESSION_COOKIE, {
    httpOnly: true,
    secure: true,
    sameSite: "none",
    path: "/",
  });
}
