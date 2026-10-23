import { describe, expect, it } from "vitest";
import { resolveRouteSeo } from "./seo";

describe("resolveRouteSeo", () => {
  it("brands a title that does not carry the product name", () => {
    expect(
      resolveRouteSeo(
        { title: "Connexion", description: "d", path: "/login" },
        "https://x.test"
      ).title
    ).toBe("Connexion — UptimePulse");
  });

  it("leaves an already complete title alone", () => {
    expect(
      resolveRouteSeo(
        { title: "UptimePulse — page de statut", description: "d", path: "/s" },
        "https://x.test"
      ).title
    ).toBe("UptimePulse — page de statut");
  });

  it("rebuilds the canonical from the current origin", () => {
    expect(
      resolveRouteSeo(
        { title: "t", description: "d", path: "/status/services-prod" },
        "https://uptimepulse.test/"
      ).canonical
    ).toBe("https://uptimepulse.test/status/services-prod");
    expect(
      resolveRouteSeo(
        { title: "t", description: "d", path: "/" },
        "https://x.test"
      ).canonical
    ).toBe("https://x.test/");
  });

  it("noindexes on request, indexes otherwise", () => {
    expect(
      resolveRouteSeo(
        { title: "t", description: "d", path: "/dashboard", noindex: true },
        "https://x.test"
      ).robots
    ).toBe("noindex,nofollow");
    expect(
      resolveRouteSeo(
        { title: "t", description: "d", path: "/" },
        "https://x.test"
      ).robots
    ).toContain("index,follow");
  });

  it("tolerates a path missing its leading slash", () => {
    expect(
      resolveRouteSeo(
        { title: "t", description: "d", path: "login" },
        "https://x.test"
      ).canonical
    ).toBe("https://x.test/login");
  });
});
