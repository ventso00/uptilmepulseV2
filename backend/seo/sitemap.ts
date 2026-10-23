/**
 * The two files a robot asks for before anything else.
 *
 * URLs are rebuilt from the request origin, never from a constant: this project
 * already shipped a `sitemap.xml` and an `og:url` pointing at a domain that no
 * longer exists, and a frozen list would not survive a deployment rename. Only
 * genuinely public pages are listed — a `dashboard` in the sitemap directly
 * contradicts robots.txt.
 */

/** Indexable static routes: the entry tunnel, nothing private. */
export const PUBLIC_PATHS = ["/", "/login", "/register"] as const;

const CHANGEFREQ: Record<string, "daily" | "weekly" | "monthly"> = {
  "/": "daily",
  "/login": "monthly",
  "/register": "monthly",
};

/** An `&` or a `<` in a slug would break the whole document. */
function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function isoDate(value: Date | null | undefined): string | undefined {
  if (!value) return undefined;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return undefined;
  return parsed.toISOString().slice(0, 10);
}

export function buildSitemapXml(
  origin: string,
  pages: { slug: string; updatedAt?: Date | null }[] = []
): string {
  const base = origin.replace(/\/+$/, "");
  const entries: { path: string; lastmod?: string }[] = PUBLIC_PATHS.map(
    path => ({
      path,
    })
  );
  for (const page of pages) {
    entries.push({
      path: `/status/${page.slug}`,
      lastmod: isoDate(page.updatedAt),
    });
  }

  const urls = entries.map(entry => {
    const changefreq = CHANGEFREQ[entry.path];
    return [
      "  <url>",
      `    <loc>${escapeXml(`${base}${entry.path}`)}</loc>`,
      changefreq ? `    <changefreq>${changefreq}</changefreq>` : "",
      entry.lastmod ? `    <lastmod>${entry.lastmod}</lastmod>` : "",
      "  </url>",
    ]
      .filter(Boolean)
      .join("\n");
  });

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...urls,
    "</urlset>",
    "",
  ].join("\n");
}

/**
 * `/support/` carries an access token: indexing it would expose it in search
 * results. `/status/` stays open — that page exists to be shared.
 */
export function buildRobotsTxt(origin: string): string {
  const base = origin.replace(/\/+$/, "");
  return [
    "User-agent: *",
    "Allow: /",
    "Disallow: /api/",
    "Disallow: /dashboard",
    "Disallow: /settings",
    "Disallow: /monitors/",
    "Disallow: /qa",
    "Disallow: /console",
    "Disallow: /support/",
    "",
    `Sitemap: ${base}/sitemap.xml`,
    "",
  ].join("\n");
}
