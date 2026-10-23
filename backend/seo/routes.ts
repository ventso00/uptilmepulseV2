import type { Express, Request, Response } from "express";
import { statusPages } from "@shared/db/schema";
import { statusPageSlugSchema } from "@shared/contracts";
import { getDb } from "../db";
import { asyncHandler, sendError } from "../_core/http";
import { buildRobotsTxt, buildSitemapXml } from "./sitemap";

/**
 * The `Host` header comes from the client. Unchecked, a crafted request would
 * publish another domain's URLs inside the sitemap. Only characters a real
 * host can carry survive — brackets for IPv6, colon for the port — so no `/`,
 * `?`, `#` or `@` can smuggle a path into an `<loc>`.
 */
const HOST_PATTERN = /^[A-Za-z0-9._:[\]-]{1,253}$/;

export function requestOrigin(req: Request, res: Response): string | null {
  const host = req.get("host");
  if (!host || !HOST_PATTERN.test(host)) {
    sendError(res, 400, "BAD_REQUEST", "Requête invalide");
    return null;
  }
  return `${req.protocol}://${host}`;
}

export function registerSeoRoutes(app: Express) {
  app.get(
    "/robots.txt",
    asyncHandler(async (req, res) => {
      const origin = requestOrigin(req, res);
      if (!origin) return;
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.setHeader("Cache-Control", "public, max-age=86400");
      return res.send(buildRobotsTxt(origin));
    })
  );

  app.get(
    "/sitemap.xml",
    asyncHandler(async (req, res) => {
      const origin = requestOrigin(req, res);
      if (!origin) return;
      // Without a database the plan stays valid: it simply lists the fixed
      // routes. A missing `DATABASE_URL` is not a 503 for a file Google
      // expects to find.
      const db = await getDb();
      const rows = db
        ? await db
            .select({
              slug: statusPages.slug,
              updatedAt: statusPages.updatedAt,
            })
            .from(statusPages)
        : [];
      const published = rows.filter(
        row => statusPageSlugSchema.safeParse(row.slug).success
      );

      res.setHeader("Content-Type", "application/xml; charset=utf-8");
      res.setHeader("Cache-Control", "public, max-age=3600");
      return res.send(buildSitemapXml(origin, published));
    })
  );
}
