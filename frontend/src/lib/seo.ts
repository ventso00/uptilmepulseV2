import { useEffect } from "react";

/**
 * Per-route SEO tags for a single-page app.
 *
 * The static `<head>` served by the CDN is identical for every URL, so without
 * this file `/login`, `/dashboard` and a status page would all carry the
 * landing title. Google replays JavaScript and re-reads the DOM, which makes
 * these writes indexable; preview robots do not run JavaScript, which is why
 * the absolute social tags stay a build-time concern (see seoTags.ts).
 *
 * The client `noindex` is not a duplicate of robots.txt: the shared head
 * declares `index,follow` for every route, private ones included.
 */

const BRAND = "UptimePulse";

export type RouteSeo = {
  title: string;
  description: string;
  /** Absolute path without an origin, e.g. `/status/my-page`. */
  path: string;
  noindex?: boolean;
};

export type ResolvedRouteSeo = {
  title: string;
  description: string;
  canonical: string;
  robots: string;
};

export function resolveRouteSeo(
  seo: RouteSeo,
  origin: string
): ResolvedRouteSeo {
  const base = origin.replace(/\/+$/, "");
  const path = seo.path.startsWith("/") ? seo.path : `/${seo.path}`;
  return {
    title: seo.title.includes(BRAND) ? seo.title : `${seo.title} — ${BRAND}`,
    description: seo.description,
    canonical: `${base}${path}`,
    robots: seo.noindex
      ? "noindex,nofollow"
      : "index,follow,max-image-preview:large",
  };
}

function upsertMeta(name: string, value: string) {
  let tag = document.head.querySelector<HTMLMetaElement>(
    `meta[name="${name}"]`
  );
  if (!tag) {
    tag = document.createElement("meta");
    tag.name = name;
    document.head.append(tag);
  }
  tag.setAttribute("content", value);
}

function upsertCanonical(href: string) {
  let link = document.head.querySelector<HTMLLinkElement>(
    'link[rel="canonical"]'
  );
  if (!link) {
    link = document.createElement("link");
    link.rel = "canonical";
    document.head.append(link);
  }
  link.href = href;
}

export function useRouteSeo(seo: RouteSeo) {
  const { title, description, path, noindex } = seo;
  useEffect(() => {
    const resolved = resolveRouteSeo(
      { title, description, path, noindex },
      window.location.origin
    );
    document.title = resolved.title;
    upsertMeta("description", resolved.description);
    upsertMeta("robots", resolved.robots);
    upsertCanonical(resolved.canonical);
  }, [title, description, path, noindex]);
}
