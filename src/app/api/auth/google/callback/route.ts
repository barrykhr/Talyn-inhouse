import { createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { createSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { GoogleAuthError, OAUTH_COOKIE, PENDING_COOKIE, appOrigin, finishAuth, googleConfigured } from "@/lib/google";
import { logError } from "@/lib/log";

export async function GET(req: Request) {
  const origin = appOrigin(req);
  const fail = (code: string) => NextResponse.redirect(`${origin}/login?error=${code}`);
  if (!googleConfigured()) return fail("config");

  const jar = await cookies();
  const saved = jar.get(OAUTH_COOKIE)?.value;
  jar.delete({ name: OAUTH_COOKIE, path: "/api/auth/google" });

  try {
    const profile = await finishAuth(req, saved);

    // 1. Returning Google user.
    let user = await db.user.findUnique({ where: { googleSub: profile.sub }, include: { memberships: { orderBy: { createdAt: "asc" } } } });

    // 2. Existing password account with the same (Google-verified) email: link it.
    //    Password sign-up never verified the email, so the Google owner of the address takes
    //    precedence: the old password and any existing sessions are revoked.
    if (!user) {
      const byEmail = await db.user.findUnique({ where: { email: profile.email } });
      if (byEmail) {
        await db.session.deleteMany({ where: { userId: byEmail.id } });
        user = await db.user.update({
          where: { id: byEmail.id },
          data: { googleSub: profile.sub, passwordHash: null },
          include: { memberships: { orderBy: { createdAt: "asc" } } },
        });
      }
    }

    if (user) {
      const membership = user.memberships[0];
      if (!membership) return fail("failed");
      await createSession(user.id, membership.orgId);
      return NextResponse.redirect(`${origin}/roles`);
    }

    // 3. New user: hold the verified identity briefly and ask for the company name.
    const token = randomBytes(32).toString("base64url");
    await db.pendingSignup.deleteMany({ where: { OR: [{ googleSub: profile.sub }, { expiresAt: { lt: new Date() } }] } });
    await db.pendingSignup.create({
      data: {
        id: createHash("sha256").update(token).digest("hex"),
        googleSub: profile.sub,
        email: profile.email,
        name: profile.name,
        expiresAt: new Date(Date.now() + 30 * 60 * 1000),
      },
    });
    jar.set(PENDING_COOKIE, token, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 1800 });
    return NextResponse.redirect(`${origin}/signup/google`);
  } catch (err) {
    if (err instanceof GoogleAuthError) return fail(err.code);
    logError("auth.google_failed", err);
    return fail("failed");
  }
}
