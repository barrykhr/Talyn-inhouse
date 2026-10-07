"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { createSession, destroySession, requireAuth } from "@/lib/auth";
import { db } from "@/lib/db";
import { hashPassword, verifyPassword } from "@/lib/password";
import { deleteStoredFile } from "@/lib/storage";
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
  redirect("/roles");
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
  if (!(await verifyPassword(password, user.passwordHash))) return generic;
  const membership = user.memberships[0];
  if (!membership) return { error: "Your account is not part of an organization." };
  await createSession(user.id, membership.orgId);
  redirect("/roles");
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

  const resumes = await db.resume.findMany({ where: { orgId: auth.orgId }, select: { storageKey: true } });
  const members = await db.membership.findMany({ where: { orgId: auth.orgId }, select: { userId: true } });
  await db.organization.delete({ where: { id: auth.orgId } });
  await Promise.all(resumes.map((r) => deleteStoredFile(r.storageKey)));
  // Remove users who no longer belong to any organization.
  await db.user.deleteMany({ where: { id: { in: members.map((m) => m.userId) }, memberships: { none: {} } } });
  await destroySession().catch(() => {});
  redirect("/signup");
}
