// What to probe for one candidate in their interview: the role's requirements their material
// doesn't yet prove, each with a question. Uses the candidate's follow-up questions when the
// recruiter has them, otherwise a neutral, job-related template. Pure.

export type GapItem = { criterionId: string | null; criterionName: string; kind: string; importance: string; result: string; overrideResult: string | null; missingInfo: string | null };
export type FollowUp = { criterionId: string | null; criterionName: string; text: string; status: string };
export type GapProbe = { criterionName: string; status: "missing" | "unclear" | "conflicting"; why: string; probe: string; source: "follow_up" | "hiring_team" | "template"; inKit: boolean };

const STATUS: Record<string, GapProbe["status"] | undefined> = {
  not_stated: "missing",
  confirmed_absent: "missing",
  inferred: "unclear",
  partially_supported: "unclear",
  conflicting: "conflicting",
};
const WHY: Record<GapProbe["status"], string> = {
  missing: "No evidence in the CV or answers",
  unclear: "Evidence is partial or needs review",
  conflicting: "Statements disagree",
};

const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

/** A neutral, open question about a requirement (no leading wording, nothing personal). */
export function templateProbe(name: string, status: GapProbe["status"]): string {
  if (status === "conflicting") return `Can you walk me through your experience with ${lower(name)}? We found statements that don't line up, so I'd like to hear it in your words.`;
  if (status === "missing") return `Tell me about a time your work involved ${lower(name)}. What did you do, and what was the result?`;
  return `You mentioned ${lower(name)}. Walk me through a specific example: what you owned, the decisions you made, and how it turned out.`;
}

/**
 * One probe per required or preferred item that isn't supported, required items first. Skills and
 * informational items are left out. `kitCriterionIds` marks which ones the kit already covers.
 */
export function gapProbes(items: GapItem[], followUps: FollowUp[], teamQuestions: { text: string }[], kitCriterionIds: Set<string>): GapProbe[] {
  const out: (GapProbe & { preferred: boolean })[] = [];
  for (const i of items) {
    if (i.kind === "skill" || i.importance === "informational") continue;
    const status = STATUS[i.overrideResult ?? i.result];
    if (!status) continue;
    const fu = followUps.find((f) => f.status !== "rejected" && ((i.criterionId && f.criterionId === i.criterionId) || f.criterionName === i.criterionName));
    out.push({
      criterionName: i.criterionName,
      status,
      why: i.missingInfo?.trim() ? `${WHY[status]} · ${i.missingInfo.trim()}` : WHY[status],
      probe: fu?.text ?? templateProbe(i.criterionName, status),
      source: fu ? "follow_up" : "template",
      inKit: !!i.criterionId && kitCriterionIds.has(i.criterionId),
      preferred: i.importance === "preferred",
    });
  }
  // Required items first; the sort is stable, so each group keeps the criteria order.
  const probes: GapProbe[] = [...out.filter((p) => !p.preferred), ...out.filter((p) => p.preferred)].map(({ preferred: _p, ...rest }) => rest);
  for (const q of teamQuestions) if (q.text.trim()) probes.push({ criterionName: "From the hiring team", status: "unclear", why: "Question raised in hiring manager review", probe: q.text.trim().slice(0, 400), source: "hiring_team", inKit: false });
  return probes.slice(0, 12);
}
