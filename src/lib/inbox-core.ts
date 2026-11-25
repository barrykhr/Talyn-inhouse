// Pure helpers behind the inbox (no database), so they can be tested directly.

/** Short stable fingerprint of what an item says (FNV-1a), so a changed item reappears after Done. */
export function fingerprint(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  return (h >>> 0).toString(36);
}

/** Assistant follow-ups that are drafted, replied or failed already appear under replies. */
export const coveredByReplies = (detail: string | null | undefined) => /assistant draft|candidate replied|sending failed/i.test(detail ?? "");

export type InboxMark = { itemKey: string; status: string; until: Date | null };

/** Item ids a person has hidden: Done (until the item changes, since its id changes) or snoozed until a future time. */
export function hiddenKeys(marks: InboxMark[], now: number): Set<string> {
  return new Set(marks.filter((m) => m.status === "done" || (m.status === "snoozed" && m.until !== null && m.until.getTime() > now)).map((m) => m.itemKey));
}
