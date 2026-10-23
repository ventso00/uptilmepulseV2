import "dotenv/config";
import express, { type Express } from "express";
import { createServer } from "http";
import { sql } from "drizzle-orm";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerOAuthRoutes } from "./oauth";
import { publicPlatformScript } from "./publicConfig";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { setupVite } from "./vite";
import { serveStatic } from "./static";
import { registerApplicationAuthRoutes } from "../auth/routes";
import { registerMonitorRoutes } from "../monitors/routes";
import { registerDiagnosticRoute } from "../checks/diagnostic";
import { registerDashboardRoutes } from "../dashboard/routes";
import { registerSchedulerRoutes } from "../scheduler/routes";
import { registerNotificationRoutes } from "../notifications/routes";
import { registerStatusPageRoutes } from "../statuspages/routes";
import { registerQaRoutes } from "../qa/routes";
import { registerAdminRoutes, registerPlanRoutes } from "../admin/routes";
import { registerSeoRoutes } from "../seo/routes";
import { ensureHeartbeatJob } from "../scheduler/register";
import { startInternalScheduler } from "../scheduler/loop";
import { errorHandler, notFoundHandler, asyncHandler } from "./http";
import { getDb } from "../db";

/**
 * Builds the Express application without binding a port.
 *
 * The split matters for deployment: the long-running Node server calls this
 * and then listens, while a serverless platform (Vercel) imports the same
 * application and hands it to the runtime. Keeping the wiring in one place
 * means both targets expose exactly the same routes, middleware order and
 * error envelope — a divergence there would be invisible until production.
 */
export async function createApp(
  options: { serveClient?: boolean } = {}
): Promise<Express> {
  const app = express();
  const server = createServer(app);
  app.disable("x-powered-by");
  app.set("trust proxy", 1);
  app.use((_req, res, next) => {
    res.setHeader(
      "X-Content-Security-Policy",
      "default-src 'self'; script-src 'self' 'unsafe-inline' https://www.googletagmanager.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"
    );
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    res.setHeader(
      "Permissions-Policy",
      "camera=(), microphone=(), geolocation=()"
    );
    next();
  });
  // No endpoint in this app accepts a payload beyond a few kilobytes; the
  // previous 50mb limit was a free denial-of-service surface.
  app.use(express.json({ limit: "64kb" }));
  app.use(express.urlencoded({ limit: "64kb", extended: true }));
  app.get(
    "/api/health",
    asyncHandler(async (_req, res) => {
      // A round-trip, not a `DATABASE_URL is set` check: a pool is created
      // lazily, so an unusable DSN still yields a client object. Without this
      // probe the app answered "ok" while every write route returned 503.
      const db = await getDb();
      let database: "ready" | "unreachable" | "unconfigured" = "unconfigured";
      if (db) {
        try {
          await db.execute(sql`select 1`);
          database = "ready";
        } catch {
          database = "unreachable";
        }
      }
      res.set("Cache-Control", "no-store");
      return res.json({
        status: database === "ready" ? "ok" : "degraded",
        database,
      });
    })
  );
  app.get("/api/platform/config.js", (_req, res) => {
    res
      .set("Cache-Control", "no-store")
      .type("application/javascript")
      .send(publicPlatformScript());
  });
  registerOAuthRoutes(app);
  registerApplicationAuthRoutes(app);
  registerMonitorRoutes(app);
  registerDiagnosticRoute(app);
  registerDashboardRoutes(app);
  registerSchedulerRoutes(app);
  registerNotificationRoutes(app);
  registerStatusPageRoutes(app);
  registerQaRoutes(app);
  registerPlanRoutes(app);
  registerAdminRoutes(app);
  // /robots.txt and /sitemap.xml are origin-served files, so they register
  // before the SPA fallback in serveStatic, which would answer an index.html.
  registerSeoRoutes(app);
  // tRPC API
  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
    })
  );
  // Unknown API paths must not fall through to the SPA, which would answer a
  // JSON client with 200 + HTML.
  app.use("/api", notFoundHandler);

  // development mode uses Vite, production mode uses static files. A
  // serverless target serves the client from the platform's own CDN, so it
  // opts out here and only answers the API.
  if (process.env.NODE_ENV === "development") {
    await setupVite(app, server);
  } else if (options.serveClient !== false) {
    serveStatic(app);
  }

  // Must be last: Express 4 requires the 4-arity error handler to be the
  // terminal middleware, and nothing after it may add routes.
  app.use(errorHandler);
  return app;
}

async function startServer() {
  const app = await createApp();
  const server = createServer(app);
  const port = Number(process.env.PORT || "3000");
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error("Invalid PORT");
  server.on("error", error => {
    console.error("Server failed:", error.message);
    process.exit(1);
  });
  server.listen(port, "0.0.0.0", () => {
    console.log(`Server listening on port ${port}`);
    void ensureHeartbeatJob();
    startInternalScheduler();
  });
}

// Only the standalone entry point binds a port. When a serverless runtime
// imports this module, the exported `createApp` is what it calls.
if (process.env.VERCEL !== "1" && process.env.UPTIMEPULSE_SERVERLESS !== "1") {
  startServer().catch(error => {
    console.error(error);
    process.exit(1);
  });
}
