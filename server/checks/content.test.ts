import { describe, expect, it } from "vitest";
import { evaluateContent } from "./client";

const contains = { keyword: "service indisponible", mustContain: true };
const forbids = { keyword: "service indisponible", mustContain: false };

describe("content assertion", () => {
  it("passes when an expected keyword is present, whatever its case", () => {
    expect(
      evaluateContent(
        contains,
        "Le Service Indisponible est de retour",
        false,
        "text/html"
      ).verdict
    ).toBe("pass");
  });

  it("fails when an expected keyword is absent from a complete body", () => {
    const outcome = evaluateContent(
      contains,
      "Tout fonctionne",
      false,
      "application/json"
    );
    expect(outcome.verdict).toBe("fail");
    expect(outcome.classification).toBe("DOWN_KEYWORD_MISSING");
  });

  it("refuses to conclude when the keyword sits beyond the read cap", () => {
    // A truncated body cannot prove absence: reporting DOWN here would open an
    // incident on every large page whose marker appears late.
    const outcome = evaluateContent(
      contains,
      "début de réponse",
      true,
      "text/html"
    );
    expect(outcome.verdict).toBe("unknown");
    expect(outcome.classification).toBeNull();
    expect(outcome.errorMessage).toContain("256");
  });

  it("fails when a forbidden keyword appears", () => {
    const outcome = evaluateContent(
      forbids,
      "état: SERVICE INDISPONIBLE",
      false,
      "text/plain"
    );
    expect(outcome.verdict).toBe("fail");
    expect(outcome.classification).toBe("DOWN_KEYWORD_PRESENT");
  });

  it("passes when a forbidden keyword stays absent", () => {
    expect(
      evaluateContent(forbids, "一切正常", false, "text/plain").verdict
    ).toBe("pass");
  });

  it("never inspects a binary or unknown content type", () => {
    const outcome = evaluateContent(
      contains,
      "service indisponible",
      false,
      "image/png"
    );
    // A byte stream read as latin-1 produces a matching string and a phantom
    // verdict, so the type gate runs before the search.
    expect(outcome.verdict).toBe("unknown");
    expect(outcome.classification).toBeNull();
    expect(outcome.errorMessage).toContain("image/png");
  });

  it("treats a truncated forbidden-keyword hit as conclusive", () => {
    // Finding the marker is proof even in a partial read; only absence is.
    expect(
      evaluateContent(forbids, "… service indisponible", true, "text/html")
        .verdict
    ).toBe("fail");
  });
});
