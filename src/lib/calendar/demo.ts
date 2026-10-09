import "server-only";
import { createHash } from "node:crypto";
import { zonedToUtc, type Busy } from "./time";

/**
 * DEMO ONLY: fictional busy blocks so the scheduling flow can be explored without Google.
 * Deterministic per person and day. Never shown as live calendar data.
 */
export function demoBusy(personKey: string, dates: string[], tz: string): Busy[] {
  const out: Busy[] = [];
  for (const d of dates) {
    const h = createHash("sha256").update(`${personKey}:${d}`).digest();
    const blocks = 1 + (h[0] % 3);
    for (let i = 0; i < blocks; i++) {
      const startHour = 9 + (h[1 + i] % 8);
      const startMin = h[4 + i] % 2 ? 30 : 0;
      const len = [30, 60, 90][h[7 + i] % 3];
      const s = zonedToUtc(d, `${String(startHour).padStart(2, "0")}:${startMin ? "30" : "00"}`, tz);
      out.push({ start: s, end: s + len * 60000 });
    }
  }
  return out;
}
