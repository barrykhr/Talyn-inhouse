import "server-only";
import { createHash } from "node:crypto";

/** Tokens are stored only as SHA-256 hashes; the token itself is shown to the admin once. */
export const notetakerTokenHash = (t: string) => createHash("sha256").update(t).digest("hex");
