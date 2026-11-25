import "server-only";
import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

/**
 * Bounded waits so a stalled database connection becomes an error the UI can show (with Retry)
 * instead of a page that stays on "Loading…" until the serverless function times out.
 * Applied only to direct postgres:// URLs and only when not already set explicitly.
 *
 * A Neon pooled URL (host contains "-pooler") runs through PgBouncer in transaction mode, which
 * doesn't keep prepared statements between queries. Prisma needs pgbouncer=true there, or queries
 * fail now and then with "prepared statement … does not exist / already exists" — the intermittent
 * "Talyn couldn't load" errors. connect_timeout allows for Neon waking a suspended database.
 */
function withTimeouts(url: string | undefined) {
  if (!url || !/^postgres(ql)?:\/\//.test(url)) return url;
  try {
    const u = new URL(url);
    if (!u.searchParams.has("connect_timeout")) u.searchParams.set("connect_timeout", "15");
    if (u.hostname.includes("-pooler") && !u.searchParams.has("pgbouncer")) u.searchParams.set("pgbouncer", "true");
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
