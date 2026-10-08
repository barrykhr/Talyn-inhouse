"use server";

import { requireAuth } from "@/lib/auth";
import { db } from "@/lib/db";

export type SearchHit = { kind: "role" | "candidate"; id: string; title: string; subtitle: string; href: string };

/** Org-scoped quick search for the command palette. */
export async function quickSearch(q: string): Promise<SearchHit[]> {
  const auth = await requireAuth();
  const query = String(q ?? "").trim().slice(0, 80);
  const contains = { contains: query, mode: "insensitive" as const };
  const [roles, candidates] = await Promise.all([
    db.role.findMany({
      where: { orgId: auth.orgId, ...(query ? { OR: [{ title: contains }, { department: contains }] } : {}) },
      select: { id: true, title: true, department: true, status: true },
      orderBy: { updatedAt: "desc" },
      take: query ? 6 : 4,
    }),
    db.candidate.findMany({
      where: { orgId: auth.orgId, ...(query ? { OR: [{ fullName: contains }, { currentTitle: contains }, { currentCompany: contains }] } : {}) },
      select: { id: true, fullName: true, currentTitle: true, currentCompany: true },
      orderBy: { updatedAt: "desc" },
      take: query ? 8 : 4,
    }),
  ]);
  return [
    ...roles.map((r) => ({ kind: "role" as const, id: r.id, title: r.title, subtitle: [r.department, r.status.replace("_", " ")].filter(Boolean).join(" · "), href: `/roles/${r.id}` })),
    ...candidates.map((c) => ({
      kind: "candidate" as const,
      id: c.id,
      title: c.fullName,
      subtitle: [c.currentTitle, c.currentCompany].filter(Boolean).join(" · "),
      href: `/candidates/${c.id}`,
    })),
  ];
}
