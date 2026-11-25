"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { TargetCompaniesDialog } from "@/components/target-companies-dialog";
import { AiMark, Card, buttonClass } from "@/components/ui";

export type TargetSummary = {
  suggested: number;
  selected: string[];
  generatedAt: string | null;
  generatedByName: string | null;
  webSearch: boolean;
  selectedByName: string | null;
  selectedAt: string | null;
} | null;

const day = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });

/**
 * The role's target companies, visible on the Discover tab: suggest, review and save which companies
 * to source from. Searches (including the daily automatic one) raise people at the saved companies;
 * nobody is hidden.
 */
export function TargetCompaniesSection({ roleId, aiConfigured, clientName, summary }: { roleId: string; aiConfigured: boolean; clientName: string | null; summary: TargetSummary }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const selected = summary?.selected ?? [];
  const hasList = !!summary && summary.suggested > 0;
  const shown = selected.slice(0, 8);

  return (
    <Card className="mb-3 p-4" aria-labelledby="targets-h">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 id="targets-h" className="text-[13px] font-semibold">
            Target companies
          </h3>
          <p className="text-[12.5px] text-muted">
            {selected.length
              ? `${selected.length} compan${selected.length === 1 ? "y" : "ies"} selected. People currently working there rank higher in every search; nobody else is hidden.`
              : hasList
                ? `${summary!.suggested} companies suggested${clientName ? ` from ${clientName}` : ""}. None selected yet.`
                : aiConfigured
                  ? `Talyn can profile ${clientName || "the client company"} and suggest similar companies to source from.${clientName ? "" : " Add the client company on the role for better suggestions."}`
                  : "Add companies to source from. AI suggestions need an AI provider."}
          </p>
          {shown.length > 0 && (
            <ul className="mt-2 flex flex-wrap gap-1.5" aria-label="Selected companies">
              {shown.map((n) => (
                <li key={n} className="rounded-md border border-line bg-sunken px-2 py-0.5 text-[12px] text-ink-2">
                  {n}
                </li>
              ))}
              {selected.length > shown.length && <li className="px-1 py-0.5 text-[12px] text-muted">+{selected.length - shown.length} more</li>}
            </ul>
          )}
          {summary && (hasList || summary.selectedAt) && (
            <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11.5px] text-faint">
              {hasList && summary.generatedAt && (
                <span className="inline-flex items-center gap-1">
                  <AiMark /> Suggested {day(summary.generatedAt)}
                  {summary.generatedByName ? ` · ${summary.generatedByName}` : ""} · {summary.webSearch ? "used web search" : "model only"}
                </span>
              )}
              {summary.selectedAt && (
                <span>
                  Selection saved {day(summary.selectedAt)}
                  {summary.selectedByName ? ` by ${summary.selectedByName}` : ""}
                </span>
              )}
            </p>
          )}
        </div>
        <button type="button" className={buttonClass(hasList || selected.length ? "secondary" : "primary", "sm")} onClick={() => setOpen(true)}>
          {hasList || selected.length ? "Review and choose" : aiConfigured ? "Suggest companies" : "Add companies"}
        </button>
      </div>
      <TargetCompaniesDialog roleId={roleId} open={open} mode="manage" onClose={() => setOpen(false)} onSaved={() => router.refresh()} />
    </Card>
  );
}
