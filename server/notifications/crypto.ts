import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const VERSION = "v1";

type TelegramConfig = { botToken: string; chatId: string };

function getKey(): Buffer {
  const raw = process.env.UPTIMEPULSE_ENCRYPTION_KEY;
  if (!raw || raw.length < 16)
    throw new Error("Encryption key is not configured");
  return createHash("sha256").update(raw).digest();
}

export function encryptTelegramConfig(config: TelegramConfig): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, getKey(), iv);
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(config), "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return [
    VERSION,
    iv.toString("base64url"),
    tag.toString("base64url"),
    ciphertext.toString("base64url"),
  ].join(".");
}

export function decryptTelegramConfig(payload: string): TelegramConfig {
  const [version, ivEncoded, tagEncoded, ciphertextEncoded] =
    payload.split(".");
  if (version !== VERSION || !ivEncoded || !tagEncoded || !ciphertextEncoded)
    throw new Error("Encrypted configuration is invalid");
  const decipher = createDecipheriv(
    ALGORITHM,
    getKey(),
    Buffer.from(ivEncoded, "base64url")
  );
  decipher.setAuthTag(Buffer.from(tagEncoded, "base64url"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(ciphertextEncoded, "base64url")),
    decipher.final(),
  ]).toString("utf8");
  const config = JSON.parse(plaintext) as Partial<TelegramConfig>;
  if (
    typeof config.botToken !== "string" ||
    typeof config.chatId !== "string" ||
    config.botToken.length < 10 ||
    config.chatId.length < 1
  )
    throw new Error("Telegram configuration is invalid");
  return { botToken: config.botToken, chatId: config.chatId };
}
