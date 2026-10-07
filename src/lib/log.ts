import "server-only";

// Minimal logger. Never pass candidate data, resume text, notes or secrets here:
// log event names, ids and error classes only.
export function logError(event: string, err: unknown, meta: Record<string, string | number | undefined> = {}) {
  const name = err instanceof Error ? err.name : typeof err;
  const status = (err as { status?: number })?.status;
  console.error(JSON.stringify({ level: "error", event, error: name, status, ...meta }));
}

export function logInfo(event: string, meta: Record<string, string | number | undefined> = {}) {
  console.info(JSON.stringify({ level: "info", event, ...meta }));
}
