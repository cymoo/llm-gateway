import crypto from "crypto";

export function generateApiKey(): string {
  return `sk-${crypto.randomBytes(16).toString("hex")}`;
}
