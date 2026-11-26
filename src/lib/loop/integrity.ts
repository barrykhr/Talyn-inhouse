// Integrity signals: things worth checking with a person. Never a verdict, never a reason to
// reject, and never shown as "fake".

const words = (t: string) => t.toLowerCase().replace(/[^a-z0-9@.+#]+/g, " ").split(" ").filter((w) => w.length > 1);

function fnv64(s: string): bigint {
  let h = 0xcbf29ce484222325n;
  for (let i = 0; i < s.length; i++) {
    h ^= BigInt(s.charCodeAt(i));
    h = (h * 0x100000001b3n) & 0xffffffffffffffffn;
  }
  return h;
}

/** 64-bit SimHash over 3-word shingles, as 16 hex characters. Near-identical texts differ in few bits. */
export function simhash(text: string): string | null {
  const w = words(text);
  if (w.length < 40) return null; // too short to compare fairly
  const v = new Array<number>(64).fill(0);
  for (let i = 0; i + 3 <= w.length; i++) {
    const h = fnv64(w.slice(i, i + 3).join(" "));
    for (let b = 0; b < 64; b++) v[b] += (h >> BigInt(b)) & 1n ? 1 : -1;
  }
  let out = 0n;
  for (let b = 0; b < 64; b++) if (v[b] > 0) out |= 1n << BigInt(b);
  return out.toString(16).padStart(16, "0");
}

export function hamming(a: string, b: string): number {
  let x = BigInt(`0x${a}`) ^ BigInt(`0x${b}`);
  let n = 0;
  while (x) {
    n += Number(x & 1n);
    x >>= 1n;
  }
  return n;
}

/** CVs this close are near copies: one changed word measures ~3 bits, an added contact line ~4, two rewritten sentences ~10, a different person in the same field ~35. */
export const NEAR_DUPLICATE_BITS = 6;

/** Word-shingle overlap (Jaccard over 4-word shingles), 0–1. */
export function overlap(a: string, b: string, n = 4): number {
  const sh = (t: string) => {
    const w = words(t);
    const s = new Set<string>();
    for (let i = 0; i + n <= w.length; i++) s.add(w.slice(i, i + n).join(" "));
    return s;
  };
  const A = sh(a);
  const B = sh(b);
  if (A.size < 5 || B.size < 5) return 0;
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  return inter / (A.size + B.size - inter);
}

/** Answers from different candidates sharing this much wording are worth a look. */
export const COPIED_ANSWER_OVERLAP = 0.6;
