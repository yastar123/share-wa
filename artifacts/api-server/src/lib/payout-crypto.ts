import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";

const secret = process.env.SESSION_SECRET
  ?? (process.env.NODE_ENV === "production"
    ? ""
    : "sharewa-development-default-session-secret-key-32chars");
if (!secret) throw new Error("SESSION_SECRET is required to encrypt payout details.");

const key = Buffer.from(hkdfSync(
  "sha256",
  Buffer.from(secret, "utf8"),
  Buffer.from("sharewa-payout-storage-v1", "utf8"),
  Buffer.from("payout-account-details", "utf8"),
  32,
));

export function encryptPayoutField(value: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return ["p1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), encrypted.toString("base64url")].join(".");
}

export function decryptPayoutField(value: string): string {
  const [version, encodedIv, encodedTag, encodedData] = value.split(".");
  if (version !== "p1") return value;
  if (!encodedIv || !encodedTag || !encodedData) {
    throw new Error("Stored payout details have an unsupported encrypted format.");
  }
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(encodedIv, "base64url"));
  decipher.setAuthTag(Buffer.from(encodedTag, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(encodedData, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}
