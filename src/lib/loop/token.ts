import "server-only";
import { createHash, randomBytes } from "node:crypto";

/** Random link token for candidate-facing links; only its hash is stored. */
export function newLinkToken(prefix: string): { token: string; hash: string } {
  const token = `${prefix}_${randomBytes(24).toString("base64url")}`;
  return { token, hash: linkTokenHash(token) };
}
export const linkTokenHash = (token: string) => createHash("sha256").update(token).digest("hex");
