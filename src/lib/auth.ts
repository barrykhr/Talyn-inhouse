import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { db } from "./db";

export const SESSION_COOKIE = "talyn_session";
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 14;

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export async function createSession(userId: string, orgId: string) {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await db.session.create({ data: { id: hashToken(token), userId, orgId, expiresAt } });
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: expiresAt,
  });
}

export async function destroySession() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) await db.session.deleteMany({ where: { id: hashToken(token) } });
  jar.delete(SESSION_COOKIE);
}

export type AuthContext = {
  userId: string;
  userName: string;
  email: string;
  orgId: string;
  orgName: string;
  membershipRole: string;
};

/** Resolves the current session. Cached per request. */
export const getAuth = cache(async (): Promise<AuthContext | null> => {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const session = await db.session.findUnique({
    where: { id: hashToken(token) },
    include: { user: true, org: true },
  });
  if (!session || session.expiresAt < new Date()) return null;
  // Membership is re-checked on every request so removed users lose access immediately.
  const membership = await db.membership.findUnique({
    where: { userId_orgId: { userId: session.userId, orgId: session.orgId } },
  });
  if (!membership) return null;
  return {
    userId: session.userId,
    userName: session.user.name,
    email: session.user.email,
    orgId: session.orgId,
    orgName: session.org.name,
    membershipRole: membership.role,
  };
});

/** For pages and server actions: every org-scoped query starts from this. */
export async function requireAuth(): Promise<AuthContext> {
  const auth = await getAuth();
  if (!auth) redirect("/login");
  return auth;
}
