import { describe, expect, it } from "vitest";
import {
  SITE_URL_PLACEHOLDER,
  applySeoTags,
  isIndexable,
  resolveSiteUrl,
} from "./seoTags";

const TEMPLATE = [
  "<head>",
  '  <link rel="canonical" href="%SITE_URL%/" />',
  '  <meta name="robots" content="index,follow,max-image-preview:large" />',
  '  <meta property="og:title" content="UptimePulse" />',
  '  <meta property="og:url" content="%SITE_URL%/" />',
  '  <meta property="og:image" content="%SITE_URL%/og-cover.png" />',
  '  <meta name="twitter:image" content="%SITE_URL%/og-cover.png" />',
  '  <script type="application/ld+json">',
  '    { "@id": "%SITE_URL%/#application" }',
  "  </script>",
  "</head>",
].join("\n");

describe("resolveSiteUrl", () => {
  it("beats the platform value and trims a trailing slash", () => {
    expect(
      resolveSiteUrl({
        SITE_URL: "https://status.example.com/",
        VERCEL_PROJECT_PRODUCTION_URL: "demo.vercel.app",
      })
    ).toBe("https://status.example.com");
  });

  it("builds an origin from the Vercel production domain", () => {
    expect(
      resolveSiteUrl({ VERCEL_PROJECT_PRODUCTION_URL: "demo.vercel.app" })
    ).toBe("https://demo.vercel.app");
  });

  it("returns null when no origin is known", () => {
    expect(resolveSiteUrl({})).toBeNull();
  });
});

describe("isIndexable", () => {
  it("refuses indexing while the origin is unknown", () => {
    expect(isIndexable({}, null)).toBe(false);
  });

  it("refuses indexing a preview", () => {
    expect(
      isIndexable({ VERCEL_ENV: "preview" }, "https://abc.vercel.app")
    ).toBe(false);
  });

  it("allows production and a build outside Vercel", () => {
    expect(isIndexable({ VERCEL_ENV: "production" }, "https://x.test")).toBe(
      true
    );
    expect(isIndexable({}, "https://x.test")).toBe(true);
  });
});

describe("applySeoTags", () => {
  it("absolutises every URL and leaves the rest of the head alone", () => {
    const out = applySeoTags(TEMPLATE, {
      siteUrl: "https://uptimepulse.example",
      indexable: true,
    });
    expect(out).not.toContain(SITE_URL_PLACEHOLDER);
    expect(out).toContain('href="https://uptimepulse.example/"');
    expect(out).toContain('content="https://uptimepulse.example/og-cover.png"');
    expect(out).toContain('property="og:title"');
    expect(out).toContain('content="index,follow,max-image-preview:large"');
  });

  it("drops unresolved tags, including the ld+json block", () => {
    const out = applySeoTags(TEMPLATE, { siteUrl: null, indexable: false });
    expect(out).not.toContain(SITE_URL_PLACEHOLDER);
    expect(out).not.toContain("og:url");
    expect(out).not.toContain("og:image");
    expect(out).not.toContain("twitter:image");
    expect(out).not.toContain("canonical");
    expect(out).not.toContain("application/ld+json");
    // Whatever does not depend on the domain survives the cleanup.
    expect(out).toContain('property="og:title"');
    expect(out).toContain('content="noindex,nofollow"');
  });

  it("noindexes a preview while keeping shareable absolute URLs", () => {
    const out = applySeoTags(TEMPLATE, {
      siteUrl: "https://abc-preview.vercel.app",
      indexable: false,
    });
    expect(out).toContain(
      'content="https://abc-preview.vercel.app/og-cover.png"'
    );
    expect(out).toContain('content="noindex,nofollow"');
  });

  it("is idempotent", () => {
    const once = applySeoTags(TEMPLATE, {
      siteUrl: "https://x.test",
      indexable: true,
    });
    expect(
      applySeoTags(once, { siteUrl: "https://x.test", indexable: true })
    ).toBe(once);
  });
});
