import { describe, expect, it } from "vitest";
import {
  driverErrorCode,
  isDuplicateKeyError,
  safeErrorMessage,
} from "./db-error";

// Shape thrown by drizzle 0.44 for any failing statement.
function wrapped(driverMessage: string, code: string) {
  const sql = "insert into `qa_runs` (`kind`, `periodKey`) values (?, ?)";
  return Object.assign(new Error(`Failed query: ${sql}\nparams: self_test,x`), {
    query: sql,
    cause: Object.assign(new Error(driverMessage), { code }),
  });
}

describe("driver error unwrapping", () => {
  it("reads the code through the query wrapper", () => {
    expect(driverErrorCode(wrapped("Duplicate entry", "ER_DUP_ENTRY"))).toBe(
      "ER_DUP_ENTRY"
    );
    expect(driverErrorCode(new Error("boom"))).toBe("");
  });

  it("recognises a unique-index conflict on either shape", () => {
    expect(
      isDuplicateKeyError(wrapped("Duplicate entry", "ER_DUP_ENTRY"))
    ).toBe(true);
    expect(
      isDuplicateKeyError(
        Object.assign(new Error("Duplicate entry for key 'PRIMARY'"), {
          code: "ER_DUP_ENTRY",
        })
      )
    ).toBe(true);
    expect(
      isDuplicateKeyError(
        Object.assign(new Error("no rows"), { code: "ECONNREFUSED" })
      )
    ).toBe(false);
  });

  it("never returns the statement text", () => {
    expect(safeErrorMessage(wrapped("Duplicate entry", "ER_DUP_ENTRY"))).toBe(
      "Duplicate entry"
    );
    expect(safeErrorMessage(new Error("plain"))).toBe("plain");
    expect(safeErrorMessage("not an error", "digest failed")).toBe(
      "digest failed"
    );
    expect(safeErrorMessage(undefined, "digest failed")).toBe("digest failed");
  });
});
