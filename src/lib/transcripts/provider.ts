import "server-only";
import { checkEnv } from "../integrations/env";
import type { ParsedSegment } from "./parse";

/**
 * Audio transcription. Off until configured. Talyn sends an uploaded recording to the provider,
 * stores only the returned timestamped text, and keeps no audio. Requests are not used for model
 * training under the provider's API terms; Talyn itself never trains on recordings or transcripts.
 */
export const TRANSCRIPTION_ENV = [
  { name: "TRANSCRIPTION_ENABLED", purpose: "Set to true once your recording and consent policy allows sending interview audio to the provider" },
  { name: "TRANSCRIPTION_PROVIDER", purpose: "openai (the only provider wired today)" },
  { name: "OPENAI_API_KEY", purpose: "API key used for transcription", secret: true },
  { name: "TRANSCRIPTION_MODEL", purpose: "Model (default whisper-1, which returns segment timestamps)", optional: true },
];

export function transcriptionSetup() {
  return checkEnv(TRANSCRIPTION_ENV);
}

export function transcriptionConfigured() {
  return transcriptionSetup().ready && process.env.TRANSCRIPTION_ENABLED === "true" && process.env.TRANSCRIPTION_PROVIDER === "openai";
}

export const MAX_AUDIO_BYTES = 24 * 1024 * 1024; // provider limit is 25 MB

export async function transcribeAudio(file: File): Promise<{ segments: ParsedSegment[]; durationMs: number | null; provider: string }> {
  const model = process.env.TRANSCRIPTION_MODEL || "whisper-1";
  const form = new FormData();
  form.append("file", file, file.name);
  form.append("model", model);
  form.append("response_format", "verbose_json");
  form.append("timestamp_granularities[]", "segment");
  const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
    body: form,
    signal: AbortSignal.timeout(280_000),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Transcription provider responded ${res.status}`);
  const body = (await res.json()) as { duration?: number; segments?: { start: number; end: number; text: string }[] };
  const segments = (body.segments ?? [])
    .map((s) => ({ startMs: Math.round(s.start * 1000), endMs: Math.round(s.end * 1000), speaker: "Unlabelled speaker", text: s.text.trim() }))
    .filter((s) => s.text);
  return { segments, durationMs: body.duration ? Math.round(body.duration * 1000) : null, provider: `openai:${model}` };
}
