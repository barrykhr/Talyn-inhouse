"use server";

import { createHash } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createSession, destroySession, requireAuth } from "@/lib/auth";
import { db } from "@/lib/db";
import { PENDING_COOKIE } from "@/lib/google";
import { hashPassword, verifyPassword } from "@/lib/password";
import { str, type ActionState } from "./form";

const SignupSchema = z.object({
  name: z.string().min(1, "Enter your name").max(120),
  email: z.string().email("Enter a valid email").max(200),
  password: z.string().min(10, "Use at least 10 characters").max(200),
  orgName: z.string().min(1, "Enter your company name").max(120),
});

export async function signup(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const parsed = SignupSchema.safeParse({
    name: str(fd, "name"),
    email: str(fd, "email").toLowerCase(),
    password: typeof fd.get("password") === "string" ? (fd.get("password") as string) : "",
    orgName: str(fd, "orgName"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the form" };
  const { name, email, password, orgName } = parsed.data;

  const existing = await db.user.findUnique({ where: { email } });
  if (existing) return { error: "An account with this email already exists. Sign in instead." };

  const passwordHash = await hashPassword(password);
  const { user, org } = await db.$transaction(async (tx) => {
    const org = await tx.organization.create({ data: { name: orgName } });
    const user = await tx.user.create({ data: { name, email, passwordHash } });
    await tx.membership.create({ data: { userId: user.id, orgId: org.id, role: "admin" } });
    return { user, org };
  });
  await createSession(user.id, org.id);
  redirect("/home");
}

export async function login(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const email = str(fd, "email").toLowerCase();
  const password = typeof fd.get("password") === "string" ? (fd.get("password") as string) : "";
  const generic = { error: "Email or password is incorrect." };
  const user = await db.user.findUnique({ where: { email }, include: { memberships: { orderBy: { createdAt: "asc" } } } });
  if (!user) {
    await hashPassword(password); // equalize timing
    return generic;
  }
  if (!user.passwordHash) {
    await hashPassword(password); // equalize timing
    return user.googleSub ? { error: "This account uses Google sign-in. Use “Continue with Google”." } : generic;
  }
  if (!(await verifyPassword(password, user.passwordHash))) return generic;
  const membership = user.memberships[0];
  // An invite link can bring someone here before they belong to a workspace.
  const next = str(fd, "next", 300);
  const safeNext = /^\/invite\/[\w-]+$/.test(next) ? next : null;
  if (!membership) {
    if (safeNext) return { error: "Sign-in worked, but you aren't in a workspace yet. Open your invite link and create your account there." };
    return { error: "Your account is not part of an organization." };
  }
  await createSession(user.id, membership.orgId);
  redirect(safeNext ?? "/home");
}

/** Second step of Google sign-up: the identity is already verified; create the workspace. */
export async function completeGoogleSignup(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const orgName = str(fd, "orgName", 120);
  if (!orgName) return { error: "Enter your company name" };
  const jar = await cookies();
  const token = jar.get(PENDING_COOKIE)?.value;
  const pending = token
    ? await db.pendingSignup.findUnique({ where: { id: createHash("sha256").update(token).digest("hex") } })
    : null;
  if (!pending || pending.expiresAt < new Date()) return { error: "This sign-up link expired. Sign in with Google again." };

  const existing = await db.user.findFirst({ where: { OR: [{ googleSub: pending.googleSub }, { email: pending.email }] } });
  if (existing) return { error: "An account for this Google user already exists. Sign in instead." };

  const { user, org } = await db.$transaction(async (tx) => {
    const org = await tx.organization.create({ data: { name: orgName } });
    const user = await tx.user.create({ data: { name: pending.name, email: pending.email, googleSub: pending.googleSub, passwordHash: null } });
    await tx.membership.create({ data: { userId: user.id, orgId: org.id, role: "admin" } });
    await tx.pendingSignup.delete({ where: { id: pending.id } });
    return { user, org };
  });
  jar.delete(PENDING_COOKIE);
  await createSession(user.id, org.id);
  redirect("/home");
}

export async function logout() {
  await destroySession();
  redirect("/login");
}

/** Permanently deletes the organization and all its roles, candidates, resumes and assessments. */
export async function deleteOrganization(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const auth = await requireAuth();
  if (auth.membershipRole !== "admin") return { error: "Only admins can delete the organization." };
  if (str(fd, "confirm") !== auth.orgName) return { error: "Type the organization name exactly to confirm." };

  const members = await db.membership.findMany({ where: { orgId: auth.orgId }, select: { userId: true } });
  await db.organization.delete({ where: { id: auth.orgId } }); // cascades to roles, candidates, files, pipelines, sourcing, outreach
  // Org-level records without a foreign key to Organization:
  await db.$transaction([
    db.auditEvent.deleteMany({ where: { orgId: auth.orgId } }),
    db.calendarConnection.deleteMany({ where: { orgId: auth.orgId } }),
    db.outreachTemplate.deleteMany({ where: { orgId: auth.orgId } }),
    db.pendingSignup.deleteMany({ where: { email: auth.email } }),
  ]);
  // Remove users who no longer belong to any organization.
  await db.user.deleteMany({ where: { id: { in: members.map((m) => m.userId) }, memberships: { none: {} } } });
  await destroySession().catch(() => {});
  redirect("/signup");
}
