import "server-only";
import { companyKey, type CallKind, type ExpectationStatus, type InterviewerRole, type ProfileCall, type QuestionAlignment } from "@/lib/calls/core";
import { db } from "@/lib/db";
import { parseClientProfile } from "@/lib/discovery/target-companies";

/** The company each role hires for: the client company, or this workspace's own company. */
export const companyNameOf = (role: { clientCompanyName: string | null }, orgName: string) => role.clientCompanyName?.trim() || orgName;

/** Every company with roles in this workspace, with counts from its roles and analysed calls. */
export async function listCompanies(orgId: string, orgName: string) {
  const roles = await db.role.findMany({
    where: { orgId },
    select: { id: true, status: true, clientCompanyName: true, calls: { where: { analysis: { isNot: null } }, select: { interviewerName: true, analysis: { select: { questionAlignment: true } } } } },
  });
  const by = new Map<string, { key: string; name: string; open: number; roles: number; calls: number; managers: Set<string>; scores: number[] }>();
  for (const r of roles) {
    const name = companyNameOf(r, orgName);
    const key = companyKey(name);
    const cur = by.get(key) ?? { key, name, open: 0, roles: 0, calls: 0, managers: new Set<string>(), scores: [] };
    cur.roles += 1;
    if (r.status === "open") cur.open += 1;
    for (const c of r.calls) {
      cur.calls += 1;
      if (c.interviewerName) cur.managers.add(c.interviewerName.trim().toLowerCase());
      if (c.analysis?.questionAlignment != null) cur.scores.push(c.analysis.questionAlignment);
    }
    by.set(key, cur);
  }
  return [...by.values()]
    .map((c) => ({ ...c, managers: c.managers.size, questionAlignment: c.scores.length ? Math.round(c.scores.reduce((a, b) => a + b, 0) / c.scores.length) : null }))
    .sort((a, b) => b.open - a.open || b.calls - a.calls || a.name.localeCompare(b.name));
}

/** One company: its roles, and the analysed calls on them shaped for the hiring manager profile. */
export async function companyDetail(orgId: string, orgName: string, key: string) {
  const roles = await db.role.findMany({
    where: { orgId },
    orderBy: { updatedAt: "desc" },
    select: {
      id: true,
      title: true,
      status: true,
      location: true,
      clientCompanyName: true,
      clientCompanyWebsite: true,
      targetCompanies: { select: { clientProfileJson: true } },
      _count: { select: { applications: true } },
      calls: {
        where: { analysis: { isNot: null } },
        select: { id: true, kind: true, interviewerName: true, interviewerRole: true, occurredAt: true, createdAt: true, analysis: { select: { questionAlignment: true, essentialCoverage: true, questionsJson: true, coverageJson: true, expectationsJson: true } } },
      },
    },
  });
  const mine = roles.filter((r) => companyKey(companyNameOf(r, orgName)) === key);
  if (!mine.length) return null;
  const calls: ProfileCall[] = mine.flatMap((r) =>
    r.calls.map((c) => ({
      callId: c.id,
      roleId: r.id,
      roleTitle: r.title,
      kind: c.kind as CallKind,
      interviewerName: c.interviewerName,
      interviewerRole: c.interviewerRole as InterviewerRole,
      occurredAt: c.occurredAt ?? c.createdAt,
      questionAlignment: c.analysis!.questionAlignment,
      essentialCoverage: c.analysis!.essentialCoverage,
      questions: (JSON.parse(c.analysis!.questionsJson) as { alignment: QuestionAlignment; kind: string; criterion: string | null; question: string }[]).map((q) => ({ alignment: q.alignment, kind: q.kind, criterionName: q.criterion, question: q.question })),
      coverage: (JSON.parse(c.analysis!.coverageJson) as { name: string; essential: boolean; asked: boolean }[]).map((x) => ({ criterionName: x.name, essential: x.essential, asked: x.asked })),
      expectations: JSON.parse(c.analysis!.expectationsJson) as { status: ExpectationStatus; topic: string }[],
    })),
  );
  const first = mine.find((r) => r.clientCompanyName) ?? mine[0];
  const profile = mine.map((r) => parseClientProfile(r.targetCompanies?.clientProfileJson)).find(Boolean) ?? null;
  return {
    name: companyNameOf(first, orgName),
    website: first.clientCompanyWebsite,
    profile,
    roles: mine.map((r) => ({ id: r.id, title: r.title, status: r.status, location: r.location, applicants: r._count.applications, calls: r.calls.length })),
    calls,
  };
}
