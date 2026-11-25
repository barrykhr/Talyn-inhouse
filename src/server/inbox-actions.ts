"use server";

import { revalidatePath } from "next/cache";
import { requireAuth } from "@/lib/auth";
import { db } from "@/lib/db";
import { UPDATES_SEEN, inboxFor, updatesFor, type InboxGroup, type InboxUpdate } from "@/lib/inbox";

export type InboxView = { groups: InboxGroup[]; count: number; updates: InboxUpdate[]; unseen: number };

/** The bell panel's contents for the signed-in person. */
export async function getInbox(): Promise<InboxView> {
  const auth = await requireAuth();
  const [needs, upd] = await Promise.all([inboxFor(auth.orgId, auth.userId), updatesFor(auth.orgId, auth.userId, auth.userName)]);
  return { groups: needs.groups, count: needs.count, updates: upd.updates, unseen: upd.unseen };
}

/** Done hides an item until it changes; Snooze hides it for a day. Neither records a decision or changes the work. */
export async function markInboxItem(itemKey: string, status: "done" | "snoozed"): Promise<{ ok: boolean }> {
  const auth = await requireAuth();
  const key = String(itemKey ?? "").slice(0, 300);
  if (!key || key === UPDATES_SEEN || (status !== "done" && status !== "snoozed")) return { ok: false };
  const until = status === "snoozed" ? new Date(Date.now() + 86_400_000) : null;
  await db.inboxState.upsert({
    where: { userId_orgId_itemKey: { userId: auth.userId, orgId: auth.orgId, itemKey: key } },
    create: { orgId: auth.orgId, userId: auth.userId, itemKey: key, status, until },
    update: { status, until },
  });
  revalidatePath("/", "layout");
  return { ok: true };
}

/** Records that this person has seen Updates now. */
export async function markUpdatesSeen(): Promise<void> {
  const auth = await requireAuth();
  await db.inboxState.upsert({
    where: { userId_orgId_itemKey: { userId: auth.userId, orgId: auth.orgId, itemKey: UPDATES_SEEN } },
    create: { orgId: auth.orgId, userId: auth.userId, itemKey: UPDATES_SEEN, status: "seen" },
    update: { status: "seen" },
  });
}
