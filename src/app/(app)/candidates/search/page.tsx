import Link from "next/link";
import { SampleBadge } from "@/components/role-workspace";
import { Breadcrumbs, Card, EmptyState, Notice, PageHeader, buttonClass } from "@/components/ui";
import { requireAuth } from "@/lib/auth";
import { MEANING_LABEL, type MeaningBand } from "@/lib/semantic/core";
import { embeddingStatus } from "@/lib/semantic/embed";
import { searchByMeaning, similarTo, type SemanticResult } from "@/server/semantic";

export const metadata = { title: "Search by meaning" };
// The first search may embed many profiles.
export const maxDuration = 300;

const BAND_CLS: Record<MeaningBand, string> = {
  strong: "bg-ok-soft text-ok border-ok/30",
  good: "bg-brand-soft text-brand border-brand/30",
  some: "bg-sunken text-ink-2 border-line",
  weak: "bg-sunken text-muted border-line",
};

const KINDS = [
  ["all", "Everyone"],
  ["candidate", "Your candidates"],
  ["sourced", "Found in Discover"],
] as const;

/**
 * Search the whole talent pool (your candidates and everyone found in Discover) by meaning, in plain
 * English, or find people like one person. Each result shows the line closest in meaning to the
 * search. Ordering only: nobody is hidden, rejected or contacted.
 */
export default async function SemanticSearchPage({ searchParams }: { searchParams: Promise<{ q?: string; in?: string; like?: string }> }) {
  const auth = await requireAuth();
  const { q = "", in: inParam = "all", like = "" } = await searchParams;
  const query = q.trim().slice(0, 500);
  const kinds = inParam === "candidate" ? (["candidate"] as const) : inParam === "sourced" ? (["sourced"] as const) : (["candidate", "sourced"] as const);
  const st = embeddingStatus();
  const [likeKind, likeId] = like.split(":");
  let result: (SemanticResult & { name?: string | null }) | null = null;
  if (st.configured && (likeKind === "candidate" || likeKind === "sourced") && likeId) result = await similarTo(auth.orgId, likeKind, likeId, { kinds: [...kinds] });
  else if (st.configured && query.length >= 3) result = await searchByMeaning(auth.orgId, query, { kinds: [...kinds] });

  return (
    <>
      <PageHeader eyebrow={<Breadcrumbs items={[{ label: "Candidates", href: "/candidates" }, { label: "Search by meaning" }]} />} title="Search by meaning" />
      <p className="mb-4 max-w-[70ch] text-[13.5px] text-muted">
        Describe the person in plain words. Talyn compares the meaning of your search with each person&apos;s work history, CV and public work, so “has scaled payments” also finds “led the settlement
        migration to Kafka at 10× volume”. Results are ordered by closeness; nobody is hidden or contacted.
      </p>
      {!st.configured && <Notice tone="warn" className="mb-4">{st.reason}</Notice>}
      {st.fake && <Notice tone="warn" className="mb-4">Test mode: matching uses shared words, not meaning (TALYN_FAKE_EMBEDDINGS is on).</Notice>}

      <form className="mb-5 flex flex-wrap items-center gap-2" action="/candidates/search">
        <label htmlFor="sq" className="sr-only">
          Describe the person
        </label>
        <input
          id="sq"
          name="q"
          defaultValue={likeId ? "" : query}
          maxLength={500}
          placeholder="e.g. backend engineer who has scaled a payments system, Go or Java"
          className="h-10 min-w-0 flex-1 rounded-lg border border-line-strong bg-surface px-3 text-[14px] focus:border-ink focus:outline-none"
        />
        <select name="in" defaultValue={inParam} aria-label="Search in" className="h-10 rounded-lg border border-line-strong bg-surface px-2 text-[13.5px]">
          {KINDS.map(([k, l]) => (
            <option key={k} value={k}>
              {l}
            </option>
          ))}
        </select>
        <button type="submit" className={buttonClass("primary")} disabled={!st.configured}>
          Search
        </button>
      </form>

      {result?.name && (
        <p className="mb-3 text-[13.5px]">
          People like <strong>{result.name}</strong>, closest first.{" "}
          <Link href="/candidates/search" className="text-muted underline">
            Clear
          </Link>
        </p>
      )}
      {result?.error && <Notice tone="danger" className="mb-4">{result.error}</Notice>}
      {result && result.indexed.pending > 0 && (
        <p className="mb-3 text-[12.5px] text-muted">
          {result.indexed.pending} more {result.indexed.pending === 1 ? "person is" : "people are"} still being added to the search. Search again in a moment to include them.
        </p>
      )}
      {result && !result.error && result.hits.length === 0 && <EmptyState title="No one yet" body="Nobody with enough work-related text to compare. Add CVs or search in Discover first." />}
      {result && result.hits.length > 0 && (
        <Card className="divide-y divide-line overflow-hidden">
          {result.hits.map((h) => (
            <div key={`${h.kind}-${h.id}`} className="flex flex-wrap items-start justify-between gap-3 px-4 py-3">
              <div className="min-w-0 space-y-0.5">
                <div className="flex flex-wrap items-center gap-2">
                  <Link href={h.href} className="text-[14px] font-semibold hover:underline">
                    {h.name}
                  </Link>
                  {h.isSample && <SampleBadge />}
                  <span className="text-[12px] text-faint">{h.context}</span>
                </div>
                <p className="text-[13px] text-muted">{[h.title, h.company, h.location].filter(Boolean).join(" · ") || "No current role on file"}</p>
                {h.quote && (
                  <p className="text-[12.5px] text-ink-2">
                    <span className="text-faint">Closest line: </span>
                    <span className="quote">“{h.quote}”</span>
                  </p>
                )}
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1.5">
                <span className={`rounded-md border px-1.5 py-0.5 text-[11.5px] font-semibold ${BAND_CLS[h.band]}`} title={`Similarity ${h.sim.toFixed(2)} (cosine). Bands are for reading, not decisions.`}>
                  {MEANING_LABEL[h.band]} <span className="font-medium tabular-nums">{h.sim.toFixed(2)}</span>
                </span>
                <Link href={`/candidates/search?like=${h.kind}:${h.id}`} className="text-[12px] text-brand hover:underline">
                  People like this →
                </Link>
              </div>
            </div>
          ))}
        </Card>
      )}
      {result && !result.error && result.hits.length > 0 && (
        <p className="mt-2 text-[11.5px] text-faint">
          Compared by {result.model}. Similarity reads meaning from text, not ability; check each person&apos;s evidence before acting.
        </p>
      )}
    </>
  );
}
