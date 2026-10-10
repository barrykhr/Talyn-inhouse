// Parses transcripts exported by meeting tools (Google Meet, Zoom, Teams) into timestamped
// segments. Only real timestamps from the file are used; a transcript without any is rejected
// rather than given invented times.

export type ParsedSegment = { startMs: number; endMs: number; speaker: string; text: string };

const TS = /(?:(\d{1,2}):)?(\d{1,2}):(\d{2})(?:[.,](\d{1,3}))?/;
function toMs(m: RegExpMatchArray) {
  const h = Number(m[1] ?? 0);
  const min = Number(m[2]);
  const s = Number(m[3]);
  const ms = Number((m[4] ?? "0").padEnd(3, "0"));
  return ((h * 60 + min) * 60 + s) * 1000 + ms;
}

/** Splits "Name: text" or "<v Name>text" into a speaker and text. */
function speakerOf(line: string): { speaker: string; text: string } {
  const v = line.match(/^<v(?:\.[^ >]+)?\s+([^>]+)>(.*?)(?:<\/v>)?$/i);
  if (v) return { speaker: v[1].trim(), text: v[2].trim() };
  const c = line.match(/^([A-Z][\w .'’-]{0,40}?):\s+(.+)$/);
  if (c) return { speaker: c[1].trim(), text: c[2].trim() };
  return { speaker: "", text: line.trim() };
}

function cues(text: string): ParsedSegment[] {
  // VTT/SRT: blocks separated by blank lines, each with a "start --> end" line.
  const out: ParsedSegment[] = [];
  for (const block of text.replace(/\r/g, "").split(/\n\s*\n/)) {
    const lines = block.split("\n").map((l) => l.trim()).filter(Boolean);
    const i = lines.findIndex((l) => l.includes("-->"));
    if (i < 0) continue;
    const [a, b] = lines[i].split("-->");
    const s = a.match(TS);
    const e = b?.match(TS);
    if (!s || !e) continue;
    const body = lines.slice(i + 1).join(" ").replace(/<\/?(?:c|b|i|u)[^>]*>/g, "").trim();
    if (!body) continue;
    const { speaker, text: t } = speakerOf(body);
    out.push({ startMs: toMs(s), endMs: toMs(e), speaker, text: t.replace(/<[^>]+>/g, "") });
  }
  return out;
}

function timestampedLines(text: string): ParsedSegment[] {
  // Plain text such as "[00:01:23] Alex: …" or "00:12 Priya: …" (Meet/Teams copy-paste).
  const out: ParsedSegment[] = [];
  for (const raw of text.replace(/\r/g, "").split("\n")) {
    const line = raw.trim();
    const m = line.match(/^\[?((?:\d{1,2}:)?\d{1,2}:\d{2}(?:[.,]\d{1,3})?)\]?\s*[-–]?\s*(.+)$/);
    if (!m) {
      if (out.length && line) out[out.length - 1].text += ` ${line}`; // continuation line
      continue;
    }
    const ts = m[1].match(TS)!;
    const { speaker, text: t } = speakerOf(m[2]);
    out.push({ startMs: toMs(ts), endMs: toMs(ts), speaker, text: t });
  }
  for (let i = 0; i < out.length; i++) out[i].endMs = out[i + 1]?.startMs ?? out[i].startMs + 5000;
  return out;
}

export function parseTranscript(text: string): { segments: ParsedSegment[]; format: "vtt" | "srt" | "text" } | { error: string } {
  const t = text.trim();
  if (!t) return { error: "The transcript is empty." };
  const fromCues = cues(t);
  if (fromCues.length) return { segments: label(fromCues), format: /^WEBVTT/i.test(t) ? "vtt" : "srt" };
  const fromLines = timestampedLines(t);
  if (fromLines.length >= 2) return { segments: label(fromLines), format: "text" };
  return { error: "No timestamps found. Export the transcript as VTT or SRT (or text with a timestamp on each line) so every passage can be checked against the conversation." };
}

/** Untagged passages get a neutral label; reviewers assign who is speaking. */
function label(segs: ParsedSegment[]) {
  return segs.map((s) => ({ ...s, speaker: s.speaker || "Unlabelled speaker", text: s.text.slice(0, 4000) })).filter((s) => s.text);
}

export function fmtTs(ms: number) {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${h ? `${h}:` : ""}${String(m).padStart(h ? 2 : 1, "0")}:${String(sec).padStart(2, "0")}`;
}

export const CONSENT_METHODS = ["verbal_at_start", "written", "policy_notice"] as const;
export const CONSENT_LABEL: Record<string, string> = {
  verbal_at_start: "Candidate agreed verbally at the start (on the recording)",
  written: "Candidate gave written consent",
  policy_notice: "Candidate was notified under our recording policy and didn't object",
};
