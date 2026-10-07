export type ActionState = { ok?: boolean; error?: string; message?: string; fieldErrors?: Record<string, string> } | undefined;

export function str(fd: FormData, key: string, max = 500): string {
  const v = fd.get(key);
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}

export function optStr(fd: FormData, key: string, max = 500): string | null {
  const v = str(fd, key, max);
  return v ? v : null;
}
