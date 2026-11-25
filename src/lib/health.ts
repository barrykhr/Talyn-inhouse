// Candidate and pipeline health: whether each person in a role is moving or drifting, computed from
// what Talyn has recorded (stage changes, messages, replies, open requests, expressed interest).
// A prompt for a person to follow up, never a decision: it doesn't move, hide or reject anyone.
// Pure functions (no database).

export type HealthBand = "healthy" | "watch" | "at_risk";
export const HEALTH_BAND_LABEL: Record<HealthBand, string> = { healthy: "Healthy", watch: "Watch", at_risk: "At risk" };
export const HEALTH_HELP = "Healthy 75+ · Watch 50–74 · At risk under 50. From time in stage, how recently there was contact, replies, open requests and what the candidate said about their interest. A prompt to follow up, never a decision.";

export const bandOf = (score: number): HealthBand => (score >= 75 ? "healthy" : score >= 50 ? "watch" : "at_risk");

/** Days a candidate usually spends in each active stage before it counts as slow. */
export const STAGE_EXPECTED_DAYS: Record<string, number> = { new: 3, in_review: 5, recruiter_screen: 7, hiring_team_review: 5, interview: 10, offer: 7 };
export const CLOSED_STAGES = new Set(["hired", "rejected"]);

export type HealthInput = {
  stage: string;
  stageSince: Date; // when the candidate entered the current stage
  decision: string | null;
  assessedAt: Date | null;
  lastContactAt: Date | null; // last message sent to the candidate
  lastReplyAt: Date | null; // last reply from the candidate
  unansweredSent: number; // messages sent since the last reply
  openTasks: number;
  overdueTasks: number;
  interest: string; // not_expressed | interested | not_now | declined
  optedOut: boolean;
  bounced: boolean;
};

export type Health = { score: number; band: HealthBand; reasons: string[] };

const days = (from: Date, now: Date) => Math.max(0, Math.floor((now.getTime() - from.getTime()) / 86_400_000));
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

/** Null for closed applications (hired or rejected): there is nothing to keep warm. */
export function candidateHealth(h: HealthInput, now = new Date()): Health | null {
  if (CLOSED_STAGES.has(h.stage)) return null;
  let score = 100;
  const reasons: string[] = [];
  const add = (penalty: number, reason: string) => {
    score -= penalty;
    reasons.push(reason);
  };

  const inStage = days(h.stageSince, now);
  const expected = STAGE_EXPECTED_DAYS[h.stage] ?? 7;
  if (inStage > expected * 2) add(35, `${plural(inStage, "day")} in this stage (usual: ${expected})`);
  else if (inStage > expected) add(15, `${plural(inStage, "day")} in this stage (usual: ${expected})`);

  if (h.assessedAt && !h.decision && days(h.assessedAt, now) > 3) add(10, `Assessed ${plural(days(h.assessedAt, now), "day")} ago, no decision yet`);

  if (h.lastContactAt) {
    const since = days(h.lastContactAt, now);
    if (since > 14) add(15, `No contact for ${plural(since, "day")}`);
    else if (since > 7) add(8, `No contact for ${plural(since, "day")}`);
  }
  if (h.unansweredSent >= 3) add(25, `${h.unansweredSent} messages without a reply`);
  else if (h.unansweredSent === 2) add(10, "2 messages without a reply");
  if (h.lastReplyAt && days(h.lastReplyAt, now) <= 7) score += 5;

  if (h.overdueTasks) add(10, `${plural(h.overdueTasks, "overdue request")}`);
  if (h.interest === "not_now") add(30, "Said “not now”");
  if (h.interest === "declined") add(50, "Declined this role");
  if (h.interest === "interested") score += 5;
  if (h.bounced) add(20, "Email bounced");
  if (h.optedOut) add(60, "Opted out of contact");

  score = Math.max(0, Math.min(100, Math.round(score)));
  if (!reasons.length) reasons.push("Moving as expected");
  return { score, band: bandOf(score), reasons };
}

export type PipelineHealth = { score: number; band: HealthBand; active: number; counts: Record<HealthBand, number>; reasons: string[] };

/** Role-level view: average candidate health, with the drifting count and thin stages called out. */
export function pipelineHealth(items: { stage: string; health: Health | null }[]): PipelineHealth | null {
  const active = items.filter((i) => i.health);
  if (!active.length) return null;
  const counts: Record<HealthBand, number> = { healthy: 0, watch: 0, at_risk: 0 };
  for (const i of active) counts[i.health!.band]++;
  let score = active.reduce((n, i) => n + i.health!.score, 0) / active.length;
  const reasons: string[] = [];
  if (counts.at_risk) reasons.push(`${plural(counts.at_risk, "candidate")} at risk`);
  if (counts.watch) reasons.push(`${counts.watch} to watch`);
  const late = active.filter((i) => ["interview", "offer"].includes(i.stage)).length;
  if (active.length < 3) {
    score -= 10;
    reasons.push(`Thin pipeline: ${plural(active.length, "active candidate")}`);
  }
  if (!late) reasons.push("No one at interview or offer yet");
  score = Math.max(0, Math.min(100, Math.round(score)));
  if (!reasons.length) reasons.push("Moving as expected");
  return { score, band: bandOf(score), active: active.length, counts, reasons };
}
