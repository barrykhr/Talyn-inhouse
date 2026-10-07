import "server-only";
import { randomBytes } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

// Resumes live outside the public web root and are only served through an
// authenticated, org-checked route handler (src/app/api/resumes/[id]/route.ts).
const ROOT = path.resolve(process.env.STORAGE_DIR || "./storage");

function resolveKey(key: string) {
  const full = path.resolve(ROOT, key);
  if (!full.startsWith(ROOT + path.sep)) throw new Error("Invalid storage key");
  return full;
}

export async function saveFile(orgId: string, ext: string, data: Buffer): Promise<string> {
  const safeExt = ext.replace(/[^a-z0-9]/gi, "").slice(0, 5);
  const key = path.join("resumes", orgId.replace(/[^a-z0-9]/gi, ""), `${randomBytes(16).toString("hex")}.${safeExt}`);
  const full = resolveKey(key);
  await mkdir(path.dirname(full), { recursive: true });
  await writeFile(full, data, { mode: 0o600 });
  return key;
}

export async function readStoredFile(key: string): Promise<Buffer> {
  return readFile(resolveKey(key));
}

export async function deleteStoredFile(key: string | null | undefined) {
  if (!key) return;
  await rm(resolveKey(key), { force: true });
}
