import clsx from "clsx";
import Link from "next/link";
import type { ReactNode } from "react";
import { APP_ORIGIN_LABEL } from "@/lib/domain";
import { SlidingIndicator } from "./nav-motion";

export type WorkspaceTab = "overview" | "applicants" | "discover" | "shortlist" | "interviews" | "criteria" | "description" | "ats";

/**
 * The role workspace: Overview, then the people areas (Applicants · Discover · Shortlist ·
 * Interviews), then the role's setup (criteria, job description, ATS) as quieter links.
 * Applicants and Discover are separate workflows; Shortlist combines both and always shows
 * where each person came from.
 */
export function RoleTabs({
  roleId,
  active,
  counts,
  attention = {},
  showAts = false,
}: {
  roleId: string;
  active: WorkspaceTab;
  counts: { applicants: number; discover: number; shortlist: number; criteria: number; interviews?: number };
  attention?: Partial<Record<WorkspaceTab, number>>;
  showAts?: boolean;
}) {
  return (
    <nav aria-label="Role workspace" className="mb-5">
      <SlidingIndicator id="role-tabs" variant="underline" className="flex flex-wrap items-end gap-x-1 border-b border-line">
      <Tab href={`/roles/${roleId}?tab=overview`} active={active === "overview"} label="Overview" hint="Criteria and the next work" />
      <Tab href={`/roles/${roleId}?tab=applicants`} active={active === "applicants"} label="Applicants" count={counts.applicants} hint="People who applied" icon={<InboundIcon />} />
      <Tab href={`/roles/${roleId}/discover`} active={active === "discover"} label="Discover" count={counts.discover} countLabel="to review" hint="People you find" icon={<OutboundIcon />} attention={attention.discover} />
      <Tab href={`/roles/${roleId}?tab=shortlist`} active={active === "shortlist"} label="Shortlist" count={counts.shortlist} hint="From both" />
      <Tab href={`/roles/${roleId}/interviews`} active={active === "interviews"} label="Interviews" count={counts.interviews} hint="Plans, scorecards, debriefs" />
      <span aria-hidden className="mx-2 mb-2 hidden h-5 w-px bg-line-strong sm:block" />
      <span className="mb-2 hidden px-1 text-[11px] font-semibold uppercase tracking-wide text-faint sm:block">Setup</span>
      <Tab href={`/roles/${roleId}?tab=criteria`} active={active === "criteria"} label="Criteria" count={counts.criteria} attention={attention.criteria} quiet />
      <Tab href={`/roles/${roleId}?tab=description`} active={active === "description"} label="Job description" attention={attention.description} quiet />
      {showAts && <Tab href={`/roles/${roleId}/ats`} active={active === "ats"} label="ATS" quiet />}
      </SlidingIndicator>
    </nav>
  );
}

function Tab({
  href,
  active,
  label,
  count,
  countLabel,
  hint,
  icon,
  attention,
  quiet,
}: {
  href: string;
  active: boolean;
  label: string;
  count?: number;
  countLabel?: string;
  hint?: string;
  icon?: ReactNode;
  attention?: number;
  quiet?: boolean;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={clsx(
        "relative -mb-px flex items-center gap-1.5 border-b-2 border-transparent px-3 py-2 font-medium transition-colors",
        quiet ? "text-[13px]" : "text-[14px]",
        active ? "text-ink" : "text-muted hover:text-ink",
      )}
    >
      {icon}
      {label}
      {count !== undefined && (
        <span className="text-[12px] tabular-nums text-faint" title={countLabel ? `${count} ${countLabel}` : undefined}>
          {count}
        </span>
      )}
      {!!attention && <span className="rounded-full bg-signal px-1.5 text-[11px] font-semibold text-white">{attention}</span>}
      {hint && !quiet && <span className="sr-only">— {hint}</span>}
    </Link>
  );
}

/** One line under the tabs that says which workflow you're in. */
export function ModeBanner({ mode, children }: { mode: "applicants" | "discover" | "shortlist"; children: ReactNode }) {
  const style = {
    applicants: { cls: "border-inbound/25 bg-inbound-soft text-inbound", title: "Applicants — inbound", icon: <InboundIcon /> },
    discover: { cls: "border-outbound/25 bg-outbound-soft text-outbound", title: "Discover — outbound", icon: <OutboundIcon /> },
    shortlist: { cls: "border-line bg-sunken text-ink-2", title: "Shortlist — from both workflows", icon: null },
  }[mode];
  return (
    <div className={clsx("mb-4 flex flex-wrap items-baseline gap-x-2 gap-y-0.5 rounded-lg border px-3 py-2 text-[13px]", style.cls)} role="note">
      <span className="flex items-center gap-1.5 font-semibold">
        {style.icon}
        {style.title}
      </span>
      <span className="text-ink-2">{children}</span>
    </div>
  );
}

/** "Applied" or "Discovered" — shown wherever a person appears in a role. */
export function OriginBadge({ origin, detail, className }: { origin: string; detail?: string | null; className?: string }) {
  const discovered = origin === "discovered";
  return (
    <span
      title={detail ?? (discovered ? "Found by a recruiter in Discover. Has not applied." : "Applied to this role.")}
      className={clsx(
        "inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11.5px] font-semibold leading-4",
        discovered ? "bg-outbound-soft text-outbound" : "bg-inbound-soft text-inbound",
        className,
      )}
    >
      {discovered ? <OutboundIcon /> : <InboundIcon />}
      {APP_ORIGIN_LABEL[origin] ?? origin}
    </span>
  );
}

export function SampleBadge({ className }: { className?: string }) {
  return (
    <span title="Fictional person from Talyn sample data — not a real candidate and not from a live search." className={clsx("inline-flex rounded-md border border-dashed border-warn/60 px-1.5 py-0.5 text-[11.5px] font-semibold leading-4 text-warn", className)}>
      Sample · fictional
    </span>
  );
}

/** Evidence found / uncertain / missing, from the latest assessment. Not a score. */
export function EvidenceCounts({ counts, className }: { counts: { found: number; uncertain: number; missing: number } | null; className?: string }) {
  if (!counts) return <span className={clsx("text-[12.5px] text-faint", className)}>Not assessed</span>;
  return (
    <span className={clsx("inline-flex flex-wrap gap-x-2 text-[12.5px]", className)} title="Per approved criterion, from the latest assessment (recruiter corrections applied). Not a score.">
      <span className="text-ok">
        <span className="font-semibold tabular-nums">{counts.found}</span> found
      </span>
      <span className="text-warn">
        <span className="font-semibold tabular-nums">{counts.uncertain}</span> uncertain
      </span>
      <span className="text-gap">
        <span className="font-semibold tabular-nums">{counts.missing}</span> missing
      </span>
    </span>
  );
}

export function InboundIcon() {
  return (
    <svg aria-hidden width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 8h9M7.5 4.5 11 8l-3.5 3.5M13.5 3v10" />
    </svg>
  );
}
export function OutboundIcon() {
  return (
    <svg aria-hidden width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
      <circle cx="7" cy="7" r="4.5" />
      <path d="m10.5 10.5 3.5 3.5" />
    </svg>
  );
}
