import "server-only";
import { db } from "@/lib/db";
import { linkTokenHash } from "@/lib/loop/token";

/** The scheduling a candidate's booking link points at, if the link is still usable. */
export async function bookingFor(token: string) {
  const s = await db.interviewScheduling.findUnique({
    where: { bookingTokenHash: linkTokenHash(token) },
    include: { stage: { include: { kit: { include: { application: { include: { role: { include: { org: { select: { id: true, name: true } } } }, candidate: { select: { fullName: true } } } } } }, events: { where: { status: "scheduled" }, take: 1 } } } },
  });
  if (!s) return null;
  const slots = (JSON.parse(s.proposedSlotsJson) as number[]).filter((t) => t > Date.now() + 15 * 60_000).sort((a, b) => a - b);
  const expired = !s.bookingExpiresAt || s.bookingExpiresAt < new Date();
  return { s, slots, expired, booked: s.stage.events[0] ?? null };
}
