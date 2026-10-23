import { describe, expect, it } from "vitest";
import { PUBLIC_PATHS, buildRobotsTxt, buildSitemapXml } from "./sitemap";

describe("buildSitemapXml", () => {
  it("lists only resolved public routes", () => {
    const xml = buildSitemapXml("https://uptimepulse.example");
    expect(xml).toContain("<loc>https://uptimepulse.example/</loc>");
    expect(xml).toContain("<loc>https://uptimepulse.example/login</loc>");
    expect(xml).not.toContain(":slug");
    expect(xml).not.toContain(":id");
    expect(xml).not.toContain("/dashboard");
  });

  it("adds published status pages with their modification date", () => {
    const xml = buildSitemapXml("https://x.test", [
      { slug: "services-prod", updatedAt: new Date("2026-10-23T09:00:00Z") },
      { slug: "api-publique" },
    ]);
    expect(xml).toContain("<loc>https://x.test/status/services-prod</loc>");
    expect(xml).toContain("<lastmod>2026-10-23</lastmod>");
    expect(xml).toContain("<loc>https://x.test/status/api-publique</loc>");
  });

  it("escapes what would break the document", () => {
    const xml = buildSitemapXml("https://x.test", [{ slug: 'a&b<c"d' }]);
    expect(xml).toContain("&amp;");
    expect(xml).not.toContain("<loc>https://x.test/status/a&b<c");
  });

  it("produces well-formed XML", () => {
    const xml = buildSitemapXml("https://x.test/", [{ slug: "s" }]);
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    // No duplicated URL, and no origin slash glued to the path.
    expect(xml).toContain("<loc>https://x.test/</loc>");
    expect(xml).not.toContain("//status");
    expect((xml.match(/<loc>/g) ?? []).length).toBe(PUBLIC_PATHS.length + 1);
  });
});

describe("buildRobotsTxt", () => {
  it("forbids the private and token-bearing routes, keeps status pages", () => {
    const txt = buildRobotsTxt("https://uptimepulse.example");
    for (const path of [
      "/api/",
      "/dashboard",
      "/settings",
      "/monitors/",
      "/qa",
      "/console",
      "/support/",
    ]) {
      expect(txt).toContain(`Disallow: ${path}`);
    }
    expect(txt).not.toContain("Disallow: /status");
    expect(txt).toContain("Sitemap: https://uptimepulse.example/sitemap.xml");
  });

  it("does not contradict the sitemap", () => {
    const lines = buildRobotsTxt("https://x.test").split("\n");
    for (const path of PUBLIC_PATHS) {
      expect(lines).not.toContain(`Disallow: ${path}`);
    }
  });
});
