import "server-only";
import { companyKey } from "@/lib/calls/core";
import { db } from "@/lib/db";

/** Company-wide memory: what hiring managers said in past calibrations and intake calls for this company. */
export async function companyMemory(orgId: string, orgName: string, roleId: string): Promise<string[]> {
  const role = await db.role.findFirst({ where: { id: roleId, orgId }, select: { clientCompanyName: true } });
  const key = companyKey(role?.clientCompanyName?.trim() || orgName);
  const roles = await db.role.findMany({ where: { orgId, id: { not: roleId } }, select: { id: true, title: true, clientCompanyName: true } });
  const ids = roles.filter((r) => companyKey(r.clientCompanyName?.trim() || orgName) === key).map((r) => r.id);
  if (!ids.length) return [];
  const [votes, intakes] = await Promise.all([
    db.calibrationVote.findMany({ where: { item: { round: { orgId, roleId: { in: ids } } }, reason: { not: "" } }, orderBy: { updatedAt: "desc" }, take: 40, select: { verdict: true, reason: true, item: { select: { round: { select: { role: { select: { title: true } } } } } } } }),
    db.callAnalysis.findMany({ where: { orgId, roleId: { in: ids }, call: { kind: "intake" } }, orderBy: { createdAt: "desc" }, take: 10, select: { expectationsJson: true } }),
  ]);
  return [
    ...votes.map((v) => `${v.item.round.role.title}: ${v.verdict === "yes" ? "would meet because" : v.verdict === "no" ? "wouldn't meet because" : "unsure:"} ${v.reason}`),
    ...intakes.flatMap((a) => (JSON.parse(a.expectationsJson) as { topic: string; status: string }[]).filter((e) => e.status !== "matches").map((e) => `Intake: ${e.topic} (${e.status.replace("_", " ")})`)),
  ].slice(0, 40);
}


export type MemoryNote = { roleId: string; roleTitle: string; kind: "calibration" | "intake"; verdict: string; text: string; by: string; at: Date };

/** What hiring managers said about these roles: calibration reasons and intake expectations beyond the JD. */
export async function memoryForRoles(orgId: string, roleIds: string[], limit = 30): Promise<MemoryNote[]> {
  if (!roleIds.length) return [];
  const [votes, intakes] = await Promise.all([
    db.calibrationVote.findMany({
      where: { item: { round: { orgId, roleId: { in: roleIds } } }, reason: { not: "" } },
      orderBy: { updatedAt: "desc" },
      take: limit,
      select: { verdict: true, reason: true, userName: true, updatedAt: true, item: { select: { name: true, round: { select: { roleId: true, role: { select: { title: true } } } } } } },
    }),
    db.callAnalysis.findMany({ where: { orgId, roleId: { in: roleIds }, call: { kind: "intake" } }, orderBy: { createdAt: "desc" }, take: 10, select: { roleId: true, createdAt: true, expectationsJson: true, call: { select: { interviewerName: true, role: { select: { title: true } } } } } }),
  ]);
  const notes: MemoryNote[] = [
    ...votes.map((v) => ({ roleId: v.item.round.roleId, roleTitle: v.item.round.role.title, kind: "calibration" as const, verdict: v.verdict, text: `${v.item.name}: ${v.reason}`, by: v.userName, at: v.updatedAt })),
    ...intakes.flatMap((a) =>
      (JSON.parse(a.expectationsJson) as { topic: string; status: string }[])
        .filter((e) => e.status !== "matches")
        .map((e) => ({ roleId: a.roleId, roleTitle: a.call.role?.title ?? "", kind: "intake" as const, verdict: e.status, text: e.topic, by: a.call.interviewerName ?? "Hiring manager", at: a.createdAt })),
    ),
  ];
  return notes.sort((x, y) => y.at.getTime() - x.at.getTime()).slice(0, limit);
}
