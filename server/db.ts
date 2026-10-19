import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2";
import { InsertUser, users } from "@shared/db/schema";
import { ENV } from "./_core/env";

/** The drizzle handle every route receives. */
export type Database = ReturnType<typeof drizzle>;

let _db: Database | null = null;

/**
 * Lazily create the drizzle instance so local tooling can run without a DB.
 *
 * The connection timezone is pinned to UTC on purpose. MySQL otherwise uses the
 * server's local zone for `NOW()` and for `TIMESTAMP` conversions, while Node
 * writes `new Date()` values in UTC. On a non-UTC host the two disagree, and
 * comparisons such as `nextCheckAt <= now()` silently stop matching, which
 * stops the scheduler from ever picking a monitor up.
 */
export async function getDb(): Promise<Database | null> {
  if (!_db && process.env.DATABASE_URL) {
    try {
      const pool = mysql.createPool({
        uri: process.env.DATABASE_URL,
        connectionLimit: 10,
        // Read/write timestamps as UTC rather than as the host's local zone.
        timezone: "Z",
        dateStrings: false,
      });
      // `timezone` governs value conversion; the session zone also decides what
      // `NOW()` and `DEFAULT CURRENT_TIMESTAMP` produce, so it is pinned on every
      // new pooled connection.
      pool.on("connection", connection => {
        connection.query("SET time_zone = '+00:00'");
      });
      _db = drizzle(pool);
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
    }
  }
  return _db;
}

export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) {
    throw new Error("User openId is required for upsert");
  }

  const db = await getDb();
  if (!db) {
    throw new Error("Database is not available");
  }

  try {
    const values: InsertUser = {
      openId: user.openId,
    };
    const updateSet: Record<string, unknown> = {};

    const textFields = ["name", "email", "loginMethod"] as const;
    type TextField = (typeof textFields)[number];

    const assignNullable = (field: TextField) => {
      const value = user[field];
      if (value === undefined) return;
      const normalized = value ?? null;
      values[field] = normalized;
      updateSet[field] = normalized;
    };

    textFields.forEach(assignNullable);

    if (user.lastSignedIn !== undefined) {
      values.lastSignedIn = user.lastSignedIn;
      updateSet.lastSignedIn = user.lastSignedIn;
    }
    if (user.role !== undefined) {
      values.role = user.role;
      updateSet.role = user.role;
    } else if (user.openId === ENV.ownerOpenId) {
      values.role = "admin";
      updateSet.role = "admin";
    }

    if (!values.lastSignedIn) {
      values.lastSignedIn = new Date();
    }

    if (Object.keys(updateSet).length === 0) {
      updateSet.lastSignedIn = new Date();
    }

    await db.insert(users).values(values).onDuplicateKeyUpdate({
      set: updateSet,
    });
  } catch (error) {
    console.error("[Database] Failed to upsert user:", error);
    throw error;
  }
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot get user: database not available");
    return undefined;
  }

  const result = await db
    .select()
    .from(users)
    .where(eq(users.openId, openId))
    .limit(1);

  return result.length > 0 ? result[0] : undefined;
}

// TODO: add feature queries here as your schema grows.
