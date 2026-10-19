import "dotenv/config";
import express from "express";
import { createServer } from "http";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerOAuthRoutes } from "./oauth";
import { publicPlatformScript } from "./publicConfig";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { setupVite } from "./vite";
import { serveStatic } from "./static";
import { registerApplicationAuthRoutes } from "../auth/routes";
import { registerMonitorRoutes } from "../monitors/routes";
import { registerDashboardRoutes } from "../dashboard/routes";
import { registerSchedulerRoutes } from "../scheduler/routes";
import { registerNotificationRoutes } from "../notifications/routes";
import { registerStatusPageRoutes } from "../statuspages/routes";
import { registerQaRoutes } from "../qa/routes";
import { registerAdminRoutes, registerPlanRoutes } from "../admin/routes";
import { ensureHeartbeatJob } from "../scheduler/register";
import { startInternalScheduler } from "../scheduler/loop";
import { errorHandler, notFoundHandler } from "./http";

async function startServer() {
  const app = express();
  const server = createServer(app);
  app.disable("x-powered-by");
  app.set("trust proxy", 1);
  app.use((_req, res, next) => {
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
  app.get("/api/health", (_req, res) => {
    res.set("Cache-Control", "no-store");
    return res.json({ status: "ok" });
  });
  app.get("/api/platform/config.js", (_req, res) => {
    res
      .set("Cache-Control", "no-store")
      .type("application/javascript")
      .send(publicPlatformScript());
  });
  registerOAuthRoutes(app);
  registerApplicationAuthRoutes(app);
  registerMonitorRoutes(app);
  registerDashboardRoutes(app);
  registerSchedulerRoutes(app);
  registerNotificationRoutes(app);
  registerStatusPageRoutes(app);
  registerQaRoutes(app);
  registerPlanRoutes(app);
  registerAdminRoutes(app);
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

  // development mode uses Vite, production mode uses static files
  if (process.env.NODE_ENV === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  // Must be last: Express 4 requires the 4-arity error handler to be the
  // terminal middleware, and nothing after it may add routes.
  app.use(errorHandler);

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

startServer().catch(error => {
  console.error(error);
  process.exit(1);
});
