import "server-only";
import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

/**
 * Bounded waits so a stalled database connection becomes an error the UI can show (with Retry)
 * instead of a page that stays on "Loading…" until the serverless function times out.
 * Applied only to direct postgres:// URLs and only when not already set explicitly.
 */
function withTimeouts(url: string | undefined) {
  if (!url || !/^postgres(ql)?:\/\//.test(url)) return url;
  try {
    const u = new URL(url);
    if (!u.searchParams.has("connect_timeout")) u.searchParams.set("connect_timeout", "10");
    if (!u.searchParams.has("pool_timeout")) u.searchParams.set("pool_timeout", "10");
    if (!u.searchParams.has("socket_timeout")) u.searchParams.set("socket_timeout", "30");
    return u.toString();
  } catch {
    return url;
  }
}

// Query logging is intentionally off: queries carry candidate personal data.
export const db = globalForPrisma.prisma ?? new PrismaClient({ log: ["error"], datasourceUrl: withTimeouts(process.env.DATABASE_URL) });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = db;
