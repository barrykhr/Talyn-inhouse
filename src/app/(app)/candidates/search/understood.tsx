"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { AiMark } from "@/components/ui";
import { interpretSearch, type SearchChip } from "@/server/discovery-actions";

const KIND_LABEL: Record<SearchChip["kind"], string> = { role: "Role", title: "Title", skill: "Skill", years: "Experience", location: "Location", work: "Work", need: "Looking for" };

/**
 * "Talyn understood": the search read as chips. Removing one searches again without it. The chips
 * explain the search; the search itself compares meaning, so a chip never filters anyone out.
 */
export function SearchUnderstood({ query, scope }: { query: string; scope: string }) {
  const [chips, setChips] = useState<SearchChip[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    setChips(null);
    setError(null);
    interpretSearch(query)
      .then((r) => live && ("error" in r ? setError(r.error) : setChips(r.chips)))
      .catch(() => live && setError("Couldn't show how the search was read this time."));
    return () => {
      live = false;
    };
  }, [query]);
  const without = (i: number) => {
    const rest = (chips ?? []).filter((_, k) => k !== i).map((c) => c.label);
    return `/candidates/search?q=${encodeURIComponent(rest.join(" · "))}${scope && scope !== "all" ? `&in=${scope}` : ""}`;
  };
  if (error) return null;
  return (
    <div className="mb-4 flex flex-wrap items-center gap-1.5 text-[12.5px]" aria-live="polite">
      <span className="mr-1 flex items-center gap-1.5 font-medium text-muted">
        <AiMark /> Talyn understood
      </span>
      {!chips &&
        [72, 96, 64, 88].map((w, i) => <span key={i} className="motion-shimmer h-6 rounded-full bg-sunken" style={{ width: w }} aria-hidden />)}
      {chips?.map((c, i) => (
        <span key={`${c.kind}-${c.label}`} className="motion-pop inline-flex items-center gap-1 rounded-full border border-line bg-surface py-0.5 pl-2.5 pr-1" style={{ animationDelay: `${i * 40}ms` }}>
          <span className="text-faint">{KIND_LABEL[c.kind]}:</span> {c.label}
          {chips.length > 1 && (
            <Link href={without(i)} aria-label={`Search again without ${c.label}`} className="ml-0.5 flex h-5 w-5 items-center justify-center rounded-full text-muted hover:bg-sunken hover:text-ink">
              ×
            </Link>
          )}
        </span>
      ))}
      {chips && chips.length === 0 && <span className="text-faint">nothing specific; matching on the whole sentence</span>}
    </div>
  );
}
