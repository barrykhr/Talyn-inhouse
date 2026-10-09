import "server-only";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

// AES-256-GCM for secrets stored in the database (e.g. Google refresh tokens). The key comes from
// TOKEN_ENCRYPTION_KEY (a long random string, kept in the environment). Never logged.

export function secretboxConfigured() {
  return (process.env.TOKEN_ENCRYPTION_KEY?.trim().length ?? 0) >= 32;
}

function key() {
  const k = process.env.TOKEN_ENCRYPTION_KEY?.trim();
  if (!k || k.length < 32) throw new Error("TOKEN_ENCRYPTION_KEY is not set");
  return createHash("sha256").update(k).digest();
}

export function seal(plain: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key(), iv);
  const data = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return `v1.${iv.toString("base64url")}.${c.getAuthTag().toString("base64url")}.${data.toString("base64url")}`;
}

export function open(sealed: string): string {
  const [v, iv, tag, data] = sealed.split(".");
  if (v !== "v1" || !iv || !tag || !data) throw new Error("Unrecognized sealed value");
  const d = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64url"));
  d.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([d.update(Buffer.from(data, "base64url")), d.final()]).toString("utf8");
}
