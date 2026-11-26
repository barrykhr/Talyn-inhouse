// Past candidates worth another look: people who got far for another role but weren't hired.

const DEPTH: Record<string, number> = { new: 0, in_review: 1, recruiter_screen: 2, hiring_team_review: 3, interview: 4, offer: 5, hired: 6, rejected: -1 };
const LABEL: Record<string, string> = { recruiter_screen: "recruiter screen", hiring_team_review: "hiring team review", interview: "interview", offer: "offer" };

export type PastApp = { roleTitle: string; stagesReached: string[]; decision: string | null; kitDecision: string | null; at: Date };

/** Furthest stage they reached (from the stage history), ignoring "rejected". */
export function furthest(stages: string[]): string | null {
  let best: string | null = null;
  for (const s of stages) if ((DEPTH[s] ?? -1) > (best ? DEPTH[best] : -1)) best = s;
  return best;
}

/** Whether a past application makes someone worth another look: shortlisted, or reached the hiring team. */
export function isSilver(a: PastApp): boolean {
  const f = furthest(a.stagesReached);
  if (f === "hired") return false;
  return (f !== null && DEPTH[f] >= DEPTH.hiring_team_review) || a.decision === "advance" || a.kitDecision === "advance" || a.kitDecision === "hold";
}

/** Depth for ordering when there's no meaning match: further and more recent first. */
export function silverDepth(a: PastApp): number {
  const f = furthest(a.stagesReached);
  return (f ? DEPTH[f] : 0) + (a.decision === "advance" ? 0.5 : 0);
}

/** "Reached interview for Data Engineer (Mar 2026), shortlisted" — built only from records. */
export function silverReason(a: PastApp): string {
  const f = furthest(a.stagesReached);
  const when = a.at.toLocaleDateString("en-GB", { month: "short", year: "numeric" });
  const parts = [`${f && LABEL[f] ? `Reached ${LABEL[f]}` : "Considered"} for ${a.roleTitle} (${when})`];
  if (a.decision === "advance") parts.push("shortlisted");
  if (a.kitDecision === "hold") parts.push("team decision: hold");
  if (a.kitDecision === "advance") parts.push("team decision: advance");
  return parts.join(", ");
}
