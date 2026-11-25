import "server-only";
import OpenAI from "openai";
import { logError } from "../log";
import { EMBED_DIMS, fakeEmbed, normalize } from "./core";

// Embeddings for search by meaning. OpenAI text-embedding-3-small at 256 dimensions (OPENAI_API_KEY;
// optional EMBEDDING_MODEL). Anthropic has no embeddings API, so search by meaning needs an OpenAI key
// even when Talyn's AI provider is Anthropic. TALYN_FAKE_EMBEDDINGS=1 uses a word-overlap stand-in
// for local development only, and says so wherever results are shown.

export class EmbeddingError extends Error {}

export function embeddingStatus(): { configured: boolean; model: string; fake: boolean; reason: string | null } {
  if (process.env.TALYN_FAKE_EMBEDDINGS === "1") return { configured: true, model: `fake-words@${EMBED_DIMS}`, fake: true, reason: null };
  const key = process.env.OPENAI_API_KEY?.trim();
  const model = process.env.EMBEDDING_MODEL?.trim() || "text-embedding-3-small";
  if (!key) return { configured: false, model: `openai:${model}@${EMBED_DIMS}`, fake: false, reason: "Search by meaning needs an OpenAI API key (OPENAI_API_KEY). Anthropic doesn't offer embeddings." };
  return { configured: true, model: `openai:${model}@${EMBED_DIMS}`, fake: false, reason: null };
}

let client: OpenAI | null = null;

/** Unit-length vectors, one per text, in order. Batches of 96; empty texts get a zero vector. */
export async function embedTexts(texts: string[]): Promise<number[][]> {
  const st = embeddingStatus();
  if (!st.configured) throw new EmbeddingError(st.reason ?? "Search by meaning isn't set up.");
  if (st.fake) return texts.map((t) => fakeEmbed(t));
  client ??= new OpenAI({ apiKey: process.env.OPENAI_API_KEY, maxRetries: 2 });
  const model = process.env.EMBEDDING_MODEL?.trim() || "text-embedding-3-small";
  const out: number[][] = [];
  for (let i = 0; i < texts.length; i += 96) {
    const batch = texts.slice(i, i + 96).map((t) => t.trim() || " ");
    try {
      const r = await client.embeddings.create({ model, input: batch, dimensions: EMBED_DIMS });
      const sorted = [...r.data].sort((a, b) => a.index - b.index);
      out.push(...sorted.map((d) => normalize(d.embedding)));
    } catch (err) {
      const status = (err as { status?: number }).status;
      logError("semantic.embed_failed", err, { model, status });
      throw new EmbeddingError(
        status === 401 ? "The OpenAI API key was rejected." : status === 429 ? "OpenAI's rate limit or credit limit was reached. Try again shortly." : "OpenAI couldn't create embeddings this time. Try again.",
      );
    }
  }
  return out;
}
