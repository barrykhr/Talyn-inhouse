// Calibration: a hiring manager says yes / no / unsure to real profiles, with a reason.

export type Verdict = "yes" | "no" | "unsure";
export const VERDICT_LABEL: Record<Verdict, string> = { yes: "Would meet", no: "Wouldn't meet", unsure: "Not sure" };

export type Vote = { verdict: Verdict; reason: string; userName: string };

export function tally(votes: Vote[]) {
  return { yes: votes.filter((v) => v.verdict === "yes").length, no: votes.filter((v) => v.verdict === "no").length, unsure: votes.filter((v) => v.verdict === "unsure").length };
}

/** Reasons people gave, grouped by verdict, for the AI and for hiring memory. */
export function reasonsByVerdict(items: { name: string; votes: Vote[] }[]) {
  const out: Record<Verdict, { name: string; reason: string; by: string }[]> = { yes: [], no: [], unsure: [] };
  for (const it of items) for (const v of it.votes) if (v.reason.trim()) out[v.verdict].push({ name: it.name, reason: v.reason.trim(), by: v.userName });
  return out;
}

/** Enough to learn from: at least 3 profiles with a vote, and at least one reason. */
export function readyToLearn(items: { votes: Vote[] }[]) {
  const voted = items.filter((i) => i.votes.length > 0).length;
  return voted >= 3 && items.some((i) => i.votes.some((v) => v.reason.trim().length > 0));
}
