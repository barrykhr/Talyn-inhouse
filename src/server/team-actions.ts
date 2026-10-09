"use server";

import { createHash, randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { audit } from "@/lib/audit";
import { createSession, getAuth, requireAuth } from "@/lib/auth";
import { db } from "@/lib/db";
import { appUrl } from "@/lib/integrations/env";
import { hashPassword } from "@/lib/password";
import { str, type ActionState } from "./form";

const ROLES = ["recruiter", "hiring_manager", "admin"] as const;
const hash = (t: string) => createHash("sha256").update(t).digest("hex");
const INVITE_DAYS = 7;

/**
 * Admin: invite a teammate. Returns a one-time link to copy — Talyn doesn't email it. The token
 * is stored only as a hash, so the link can't be shown again; revoke and re-invite if lost.
 */
export async function createInvite(_prev: ActionState & { link?: string }, fd: FormData): Promise<ActionState & { link?: string }> {
  const auth = await requireAuth();
  if (auth.membershipRole !== "admin") return { error: "Only workspace admins can invite people." };
  const parsed = z
    .object({ name: z.string().min(1, "Enter their name").max(120), email: z.string().email("Enter a valid email").max(200), role: z.enum(ROLES) })
    .safeParse({ name: str(fd, "name"), email: str(fd, "email").toLowerCase(), role: str(fd, "role") });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };
  const member = await db.membership.findFirst({ where: { orgId: auth.orgId, user: { email: parsed.data.email } } });
  if (member) return { error: "That person is already in this workspace." };
  await db.invite.updateMany({ where: { orgId: auth.orgId, email: parsed.data.email, acceptedAt: null, revokedAt: null }, data: { revokedAt: new Date() } });
  const token = randomBytes(24).toString("base64url");
  await db.invite.create({
    data: { tokenHash: hash(token), orgId: auth.orgId, ...parsed.data, invitedByName: auth.userName, expiresAt: new Date(Date.now() + INVITE_DAYS * 86400000) },
  });
  await audit(auth, "team.invited", { subjectType: "org", subjectId: auth.orgId, meta: { role: parsed.data.role } });
  revalidatePath("/settings");
  return { ok: true, link: `${appUrl()}/invite/${token}`, message: `Invite created for ${parsed.data.name}. Copy the link and send it yourself — it works once and expires in ${INVITE_DAYS} days.` };
}

export async function revokeInvite(id: string): Promise<ActionState> {
  const auth = await requireAuth();
  if (auth.membershipRole !== "admin") return { error: "Only workspace admins can do this." };
  await db.invite.updateMany({ where: { id, orgId: auth.orgId, acceptedAt: null }, data: { revokedAt: new Date() } });
  revalidatePath("/settings");
  return { ok: true };
}

export async function setMemberRole(membershipId: string, role: string): Promise<ActionState> {
  const auth = await requireAuth();
  if (auth.membershipRole !== "admin") return { error: "Only workspace admins can change roles." };
  const r = z.enum(ROLES).safeParse(role);
  if (!r.success) return { error: "Unknown role." };
  const m = await db.membership.findFirst({ where: { id: membershipId, orgId: auth.orgId } });
  if (!m) return { error: "Member not found." };
  if (m.role === "admin" && r.data !== "admin" && (await db.membership.count({ where: { orgId: auth.orgId, role: "admin" } })) <= 1) return { error: "The workspace needs at least one admin." };
  await db.membership.update({ where: { id: m.id }, data: { role: r.data } });
  await audit(auth, "team.role_changed", { subjectType: "org", subjectId: auth.orgId, meta: { role: r.data } });
  revalidatePath("/settings");
  return { ok: true };
}

async function validInvite(token: string) {
  const inv = await db.invite.findUnique({ where: { tokenHash: hash(token) }, include: { org: { select: { name: true } } } });
  if (!inv || inv.acceptedAt || inv.revokedAt || inv.expiresAt < new Date()) return null;
  return inv;
}

/** Signed-in user with the invited email joins the workspace and switches to it. */
export async function acceptInvite(token: string): Promise<ActionState> {
  const auth = await getAuth();
  const inv = await validInvite(token);
  if (!inv) return { error: "This invite is no longer valid. Ask an admin for a new one." };
  if (!auth) return { error: "Sign in first." };
  const user = await db.user.findUnique({ where: { id: auth.userId } });
  if (!user || user.email.toLowerCase() !== inv.email) return { error: `This invite is for ${inv.email}. Sign in with that account.` };
  await join(inv, user.id);
  await createSession(user.id, inv.orgId);
  redirect("/interviews");
}

/** New person: creates their account from the invite and signs them in. */
export async function acceptInviteNewAccount(token: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const inv = await validInvite(token);
  if (!inv) return { error: "This invite is no longer valid. Ask an admin for a new one." };
  const name = str(fd, "name", 120) || inv.name;
  const password = typeof fd.get("password") === "string" ? (fd.get("password") as string) : "";
  if (password.length < 10) return { error: "Use at least 10 characters for your password." };
  if (await db.user.findUnique({ where: { email: inv.email } })) return { error: "An account with this email already exists. Sign in to accept." };
  const user = await db.user.create({ data: { name, email: inv.email, passwordHash: await hashPassword(password) } });
  await join(inv, user.id);
  await createSession(user.id, inv.orgId);
  redirect("/interviews");
}

async function join(inv: { id: string; orgId: string; role: string; name: string }, userId: string) {
  await db.$transaction([
    db.membership.upsert({ where: { userId_orgId: { userId, orgId: inv.orgId } }, create: { userId, orgId: inv.orgId, role: inv.role }, update: {} }),
    db.invite.update({ where: { id: inv.id }, data: { acceptedAt: new Date() } }),
  ]);
  await audit({ orgId: inv.orgId, userId, userName: inv.name }, "team.joined", { subjectType: "org", subjectId: inv.orgId, meta: { role: inv.role } });
}
