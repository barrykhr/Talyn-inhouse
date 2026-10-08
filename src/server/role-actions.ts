"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAuth } from "@/lib/auth";
import { db } from "@/lib/db";
import { EMPLOYMENT_TYPES, ROLE_STATUSES } from "@/lib/domain";
import { goTo, str, type ActionState } from "./form";
import { ownRole } from "./scope";

const RoleSchema = z.object({
  title: z.string().min(1, "Title is required").max(160),
  department: z.string().max(120),
  location: z.string().max(160),
  employmentType: z.enum(EMPLOYMENT_TYPES),
  status: z.enum(ROLE_STATUSES),
  description: z.string().max(30000),
});

function parseRole(fd: FormData) {
  return RoleSchema.safeParse({
    title: str(fd, "title", 160),
    department: str(fd, "department", 120),
    location: str(fd, "location", 160),
    employmentType: str(fd, "employmentType") || "full_time",
    status: str(fd, "status") || "draft",
    description: str(fd, "description", 30000),
  });
}

export async function createRole(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const auth = await requireAuth();
  const parsed = parseRole(fd);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };
  const role = await db.role.create({ data: { ...parsed.data, orgId: auth.orgId, createdById: auth.userId } });
  return goTo(`/roles/${role.id}`);
}

export async function updateRole(roleId: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const auth = await requireAuth();
  await ownRole(auth, roleId);
  const parsed = parseRole(fd);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };
  await db.role.update({ where: { id: roleId }, data: parsed.data });
  return goTo(`/roles/${roleId}`);
}

export async function setRoleStatus(roleId: string, status: string) {
  const auth = await requireAuth();
  await ownRole(auth, roleId);
  const s = z.enum(ROLE_STATUSES).parse(status);
  await db.role.update({ where: { id: roleId }, data: { status: s } });
  revalidatePath(`/roles/${roleId}`);
  revalidatePath("/roles");
}

export async function deleteRole(roleId: string) {
  const auth = await requireAuth();
  await ownRole(auth, roleId);
  await db.role.delete({ where: { id: roleId } });
  return goTo("/roles");
}

