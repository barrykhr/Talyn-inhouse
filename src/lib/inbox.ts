import "server-only";
import { attention } from "./attention";
import { db } from "./db";
import { ATS_ENABLED } from "./features";
import { AUDIT_LABEL } from "./audit";
import { coveredByReplies, fingerprint as fp, hiddenKeys } from "./inbox-core";
import { buildQueue } from "./queue";

// The inbox: one list of everything waiting on a person, merged from the role-level attention
// groups and the person-level queue (overlaps removed), grouped by what to do. Each person can
// mark an item Done or Snooze it; an item comes back when what it describes changes. "Updates" is
// recent activity by others, for awareness only. Real records only; nothing is estimated.

export type InboxVerb = "decide" | "review" | "approve" | "reply" | "schedule" | "fix";
export const VERB_LABEL: Record<InboxVerb, string> = {
  decide: "Decide",
  review: "Review",
  approve: "Approve",
  reply: "Reply and follow up",
  schedule: "Interviews",
  fix: "Fix",
};
const VERB_ORDER: InboxVerb[] = ["decide", "review", "approve", "reply", "schedule", "fix"];

export type InboxItem = {
  id: string; // stable per state: changes when the item's content changes, so Done doesn't hide new work
  verb: InboxVerb;
  title: string;
  detail: string;
  href: string;
  action: string;
  at: string | null; // ISO
};
export type InboxGroup = { verb: InboxVerb; label: string; items: InboxItem[] };
export type InboxUpdate = { id: string; actor: string; text: string; at: string; href: string | null };

const ATTENTION_VERB: Record<string, InboxVerb> = {
  applicants: "review",
  criteria: "approve",
  profiles: "review",
  discover: "review",
  outreach_drafts: "approve",
  outreach_due: "reply",
  replies: "reply",
  interviews: "schedule",
};
// Queue sections the attention groups don't already cover.
const QUEUE_VERB: Record<string, InboxVerb> = { evidence: "reply", assessment: "review", decision: "decide", ...(ATS_ENABLED ? { ats: "fix" as const, ats_push: "fix" as const } : {}) };

async function allItems(orgId: string): Promise<InboxItem[]> {
  const [groups, sections, calls] = await Promise.all([
    attention(orgId),
    buildQueue(orgId),
    db.roleCall.findMany({ where: { orgId, status: "needs_role" }, orderBy: { createdAt: "asc" }, take: 50, select: { id: true, title: true, provider: true, createdAt: true } }),
  ]);
  const out: InboxItem[] = [];
  // Calls a notetaker sent: a person says which role they belong to and who was on them.
  for (const c of calls) {
    const detail = `From ${c.provider.split(":")[1] ?? "your notetaker"} · say which role and who was on it`;
    out.push({ id: `call:${c.id}:${fp(detail)}`, verb: "review", title: `Set up call: ${c.title}`, detail, href: `/calls/${c.id}`, action: "Set up", at: c.createdAt.toISOString() });
  }
  for (const g of groups) {
    const verb = ATTENTION_VERB[g.key] ?? "review";
    for (const it of g.items) out.push({ id: `${g.key}:${it.key}:${fp(it.detail)}`, verb, title: it.title, detail: it.detail, href: it.href, action: it.action, at: it.at?.toISOString() ?? null });
  }
  for (const s of sections) {
    const verb = QUEUE_VERB[s.key];
    if (!verb) continue;
    for (const it of s.items) {
      if (s.key === "evidence" && coveredByReplies(it.detail)) continue;
      const detail = [s.title, it.roleTitle, it.detail].filter(Boolean).join(" · ");
      out.push({ id: `${s.key}:${it.key}:${fp(detail)}`, verb, title: it.candidateName, detail, href: it.href, action: s.key === "decision" ? "Decide" : s.key === "assessment" ? "Review" : "Open", at: it.since.toISOString() });
    }
  }
  return out;
}

/** What's waiting on this person, minus what they marked Done (until it changes) or snoozed (until the time comes). */
export async function inboxFor(orgId: string, userId: string): Promise<{ groups: InboxGroup[]; count: number }> {
  const [items, states] = await Promise.all([allItems(orgId), db.inboxState.findMany({ where: { orgId, userId, NOT: { itemKey: UPDATES_SEEN } }, select: { itemKey: true, status: true, until: true } })]);
  const hidden = hiddenKeys(states, Date.now());
  // Calibration rounds with profiles this person hasn't reacted to yet.
  const rounds = await db.calibrationRound.findMany({
    where: { orgId, status: "open" },
    select: { id: true, roleId: true, createdAt: true, createdByName: true, role: { select: { title: true } }, items: { select: { votes: { where: { userId }, select: { id: true } } } } },
    take: 20,
  });
  for (const r of rounds) {
    const left = r.items.filter((i) => i.votes.length === 0).length;
    if (!left) continue;
    const detail = `${left} profile${left === 1 ? "" : "s"} to react to · started by ${r.createdByName}`;
    items.push({ id: `calibration:${r.id}:${fp(String(left))}`, verb: "review", title: `Calibrate: ${r.role.title}`, detail, href: `/roles/${r.roleId}/calibrate`, action: "React", at: r.createdAt.toISOString() });
  }
  const open = items.filter((i) => !hidden.has(i.id)).sort((a, b) => (a.at ?? "9").localeCompare(b.at ?? "9"));
  const groups = VERB_ORDER.map((verb) => ({ verb, label: VERB_LABEL[verb], items: open.filter((i) => i.verb === verb) })).filter((g) => g.items.length);
  return { groups, count: open.length };
}

export const UPDATES_SEEN = "__updates_seen";

/** Recent activity by other people in the workspace (last 14 days), newest first, and how many are unseen. */
export async function updatesFor(orgId: string, userId: string, userName: string): Promise<{ updates: InboxUpdate[]; unseen: number }> {
  const since = new Date(Date.now() - 14 * 86_400_000);
  const [events, seen] = await Promise.all([
    db.auditEvent.findMany({
      where: { orgId, createdAt: { gte: since }, action: { notIn: ["candidate.viewed", "auth.login", "auth.logout"] }, NOT: { actorName: userName } },
      orderBy: { createdAt: "desc" },
      take: 30,
      select: { id: true, actorName: true, action: true, createdAt: true, candidateId: true, roleId: true },
    }),
    db.inboxState.findUnique({ where: { userId_orgId_itemKey: { userId, orgId, itemKey: UPDATES_SEEN } }, select: { updatedAt: true } }),
  ]);
  const seenAt = seen?.updatedAt.getTime() ?? 0;
  return {
    updates: events.map((e) => ({
      id: e.id,
      actor: e.actorName || "Talyn",
      text: (AUDIT_LABEL[e.action] ?? e.action.replace(/[._]/g, " ")).toLowerCase(),
      at: e.createdAt.toISOString(),
      href: e.candidateId ? `/candidates/${e.candidateId}${e.roleId ? `?role=${e.roleId}` : ""}` : e.roleId ? `/roles/${e.roleId}` : null,
    })),
    unseen: events.filter((e) => e.createdAt.getTime() > seenAt).length,
  };
}

/** The bell's number: items waiting on this person. Failures show 0 rather than break the page. */
export async function inboxCount(orgId: string, userId: string): Promise<number> {
  return (await inboxFor(orgId, userId)).count;
}
