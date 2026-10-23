/**
 * Resolves the SEO tags of the shared HTML template at build time.
 *
 * The frontend is a statically served SPA: the `<head>` Google and the preview
 * robots read is the one produced here, not the one the client paints after
 * load. Absolute URLs (`canonical`, `og:url`, `og:image`) therefore have to be
 * known at build.
 *
 * The central rule: a tag whose URL stays unresolved is removed rather than
 * shipped. A wrong domain is worse than no domain — it sends the crawl and the
 * share signals to an address nobody owns.
 */

export const SITE_URL_PLACEHOLDER = "%SITE_URL%";

const ROBOTS_META = /(<meta\b[^>]*name="robots"[^>]*content=")[^"]*(")/i;

/**
 * Public production origin, without a trailing slash.
 * `SITE_URL` wins (a deployment off the platform); otherwise Vercel supplies
 * `VERCEL_PROJECT_PRODUCTION_URL`, which follows a domain rename.
 */
export function resolveSiteUrl(
  env: Record<string, string | undefined>
): string | null {
  const explicit = env.SITE_URL?.trim();
  if (explicit) return explicit.replace(/\/+$/, "");
  const vercel = env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  if (vercel) {
    return `https://${vercel.replace(/^https?:\/\//, "").replace(/\/+$/, "")}`;
  }
  return null;
}

/** A preview has nothing to index: it would only duplicate production. */
export function isIndexable(
  env: Record<string, string | undefined>,
  siteUrl: string | null
): boolean {
  if (!siteUrl) return false;
  return !env.VERCEL_ENV || env.VERCEL_ENV === "production";
}

/** `meta`/`link` elements and the `ld+json` block carrying the raw placeholder. */
function dropUnresolved(html: string): string {
  let out = html.replace(/[ \t]*<(?:meta|link)\b[^>]*%SITE_URL%[^>]*>\n?/g, "");
  out = out.replace(
    /[ \t]*<script\s+type="application\/ld\+json">[\s\S]*?<\/script>\n?/g,
    block => (block.includes(SITE_URL_PLACEHOLDER) ? "" : block)
  );
  return out;
}

export function applySeoTags(
  html: string,
  options: { siteUrl: string | null; indexable: boolean }
): string {
  if (html.includes(SITE_URL_PLACEHOLDER)) {
    html = options.siteUrl
      ? html.split(SITE_URL_PLACEHOLDER).join(options.siteUrl)
      : dropUnresolved(html);
  }

  // A head without a robots tag expresses no intent, so none is invented. When
  // the tag exists it follows the build context.
  if (ROBOTS_META.test(html)) {
    html = html.replace(
      ROBOTS_META,
      `$1${
        options.indexable
          ? "index,follow,max-image-preview:large"
          : "noindex,nofollow"
      }$2`
    );
  }

  return html;
}
