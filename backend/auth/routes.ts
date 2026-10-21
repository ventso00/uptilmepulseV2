import { randomBytes } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import type { Express, Request, Response } from "express";
import { sessions, userCredentials, users } from "@shared/db/schema";
import { getDb } from "../db";
import { createSession, revokeSession } from "./session";
import { hashPassword, verifyPassword } from "./password";
import { consumeRateLimit } from "./rateLimit";
import { isOwnerEmail } from "./owner";
import { asyncHandler, requireUser, sendError } from "../_core/http";
import {
  changePasswordSchema,
  loginSchema,
  registerSchema,
} from "@shared/contracts";

const DUMMY_PASSWORD_HASH =
  "$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy";

function getClientKey(req: Request): string {
  return req.ip || req.socket.remoteAddress || "unknown";
}

function publicUser(user: {
  id: number;
  email: string | null;
  name: string | null;
  role: "user" | "admin";
}) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
  };
}

function rejectWhenLimited(
  res: Response,
  key: string,
  limit: number,
  windowMs: number
): boolean {
  const rate = consumeRateLimit(key, limit, windowMs);
  if (rate.allowed) return false;
  sendError(
    res,
    429,
    "RATE_LIMITED",
    "Too many attempts",
    rate.retryAfterSeconds
  );
  return true;
}

export function registerApplicationAuthRoutes(app: Express): void {
  app.post(
    "/api/auth/register",
    asyncHandler(async (req, res) => {
      const ip = getClientKey(req);
      if (rejectWhenLimited(res, `register:${ip}`, 5, 15 * 60_000)) return;
      // The per-email key alone cannot stop a credential-stuffing run spread
      // across many addresses, so add an aggregate per-IP cap.
      if (rejectWhenLimited(res, `register-ip:${ip}`, 20, 15 * 60_000)) return;

      const parsed = registerSchema.safeParse(req.body);
      if (!parsed.success)
        return sendError(
          res,
          400,
          "VALIDATION_ERROR",
          "Email or password is invalid"
        );

      const db = await getDb();
      if (!db)
        return sendError(
          res,
          503,
          "DATABASE_UNAVAILABLE",
          "Service unavailable"
        );

      const email = parsed.data.email;
      // Registration is not a public door: it exists so the owner can claim the
      // single account and pick its password. Any other address is refused
      // before a hash is computed, so the endpoint cannot be used to mint
      // accounts or to burn CPU on bcrypt cost 12.
      if (!isOwnerEmail(email))
        return sendError(
          res,
          403,
          "REGISTRATION_CLOSED",
          "L’inscription est réservée à l’adresse du créateur."
        );
      const existing = await db
        .select({ userId: userCredentials.userId })
        .from(userCredentials)
        .where(eq(userCredentials.emailNormalized, email))
        .limit(1);
      if (existing.length > 0)
        return sendError(
          res,
          409,
          "EMAIL_TAKEN",
          "An account already exists for this email"
        );

      const passwordHash = await hashPassword(parsed.data.password);
      const openId = `local_${randomBytes(18).toString("base64url")}`;
      const [user] = await db.transaction(async tx => {
        const result = await tx.insert(users).values({
          openId,
          email,
          loginMethod: "password",
          // The only registrable address is the owner's, so a claimed account
          // is the administrator; `users.role` can never drift to a stranger.
          role: "admin",
        });
        const userId = Number(result[0].insertId);
        await tx
          .insert(userCredentials)
          .values({ userId, emailNormalized: email, passwordHash });
        return tx
          .select({
            id: users.id,
            email: users.email,
            name: users.name,
            role: users.role,
          })
          .from(users)
          .where(eq(users.id, userId))
          .limit(1);
      });

      if (!user)
        return sendError(
          res,
          500,
          "REGISTRATION_FAILED",
          "Unable to create account"
        );
      await createSession(user.id, res);
      return res.status(201).json({ user: publicUser(user) });
    })
  );

  app.post(
    "/api/auth/login",
    asyncHandler(async (req, res) => {
      const ip = getClientKey(req);
      const parsed = loginSchema.safeParse(req.body);
      const email = parsed.success ? parsed.data.email : "invalid";
      if (rejectWhenLimited(res, `login:${ip}:${email}`, 10, 15 * 60_000))
        return;
      if (rejectWhenLimited(res, `login-ip:${ip}`, 40, 15 * 60_000)) return;
      if (!parsed.success)
        return sendError(
          res,
          400,
          "VALIDATION_ERROR",
          "Email or password is invalid"
        );

      const db = await getDb();
      if (!db)
        return sendError(
          res,
          503,
          "DATABASE_UNAVAILABLE",
          "Service unavailable"
        );

      const result = await db
        .select({ user: users, credential: userCredentials })
        .from(userCredentials)
        .innerJoin(users, eq(users.id, userCredentials.userId))
        .where(eq(userCredentials.emailNormalized, parsed.data.email))
        .limit(1);
      const record = result[0];
      const passwordMatches = await verifyPassword(
        parsed.data.password,
        record?.credential.passwordHash ?? DUMMY_PASSWORD_HASH
      );
      if (!record || !passwordMatches)
        return sendError(
          res,
          401,
          "INVALID_CREDENTIALS",
          "Email or password is invalid"
        );

      // A correct password on a legacy or demo account answers exactly like a
      // wrong one: refusing here with a distinct code would confirm that the
      // address exists and that its credentials are valid.
      if (!isOwnerEmail(record.user.email))
        return sendError(
          res,
          401,
          "INVALID_CREDENTIALS",
          "Email or password is invalid"
        );

      await db
        .update(users)
        .set({ lastSignedIn: new Date() })
        .where(eq(users.id, record.user.id));
      await createSession(record.user.id, res);
      return res.json({ user: publicUser(record.user) });
    })
  );

  app.post(
    "/api/auth/logout",
    asyncHandler(async (req, res) => {
      await revokeSession(req, res);
      return res.status(204).send();
    })
  );

  app.get(
    "/api/auth/me",
    asyncHandler(async (req, res) => {
      const user = await requireUser(req, res);
      if (!user) return;
      res.setHeader("Cache-Control", "private, no-store");
      return res.json({ user: publicUser(user) });
    })
  );

  app.post(
    "/api/auth/password",
    asyncHandler(async (req, res) => {
      const user = await requireUser(req, res);
      if (!user) return;
      // bcrypt cost 12 is deliberately expensive; uncapped, this endpoint is a
      // cheap CPU-exhaustion vector.
      if (rejectWhenLimited(res, `password:${user.id}`, 5, 15 * 60_000)) return;

      const parsed = changePasswordSchema.safeParse(req.body);
      if (!parsed.success)
        return sendError(res, 400, "VALIDATION_ERROR", "Password is invalid");

      const db = await getDb();
      if (!db)
        return sendError(
          res,
          503,
          "DATABASE_UNAVAILABLE",
          "Service unavailable"
        );
      const credential = await db
        .select()
        .from(userCredentials)
        .where(eq(userCredentials.userId, user.id))
        .limit(1);
      if (
        !credential[0] ||
        !(await verifyPassword(
          parsed.data.currentPassword,
          credential[0].passwordHash
        ))
      ) {
        return sendError(
          res,
          400,
          "INVALID_PASSWORD",
          "Current password is invalid"
        );
      }

      await db.transaction(async tx => {
        await tx
          .update(userCredentials)
          .set({ passwordHash: await hashPassword(parsed.data.newPassword) })
          .where(eq(userCredentials.userId, user.id));
        await tx
          .update(sessions)
          .set({ revokedAt: new Date() })
          .where(and(eq(sessions.userId, user.id), isNull(sessions.revokedAt)));
      });
      await createSession(user.id, res);
      return res.json({ success: true });
    })
  );
}
