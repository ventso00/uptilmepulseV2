import { describe, expect, it } from "vitest";
import { decryptTelegramConfig, encryptTelegramConfig } from "./crypto";

describe("notification configuration encryption", () => {
  it("round trips Telegram configuration", () => {
    process.env.UPTIMEPULSE_ENCRYPTION_KEY =
      "test-only-key-with-sufficient-length";
    const encrypted = encryptTelegramConfig({
      botToken: "1234567890:secret-token",
      chatId: "12345",
    });
    expect(encrypted).not.toContain("secret-token");
    expect(decryptTelegramConfig(encrypted)).toEqual({
      botToken: "1234567890:secret-token",
      chatId: "12345",
    });
  });
});
