import clsx from "clsx";
import Link from "next/link";
import { SampleBadge } from "@/components/role-workspace";
import { Badge, PageHeader } from "@/components/ui";

export type KitHeaderProps = {
  kitId: string;
  candidate: { id: string; fullName: string; isSample: boolean };
  role: { id: string; title: string };
  status: string;
  active: "plan" | "scorecard" | "debrief";
  myScorecards: { id: string; stage: string; status: string }[];
  decision: string | null;
};

const DECISION: Record<string, string> = { advance: "Advance", hold: "Hold", decline: "Decline" };

/** Shared header for an interview plan: candidate and role, then Plan · My scorecard · Debrief. */
export function KitHeader({ kitId, candidate, role, status, active, myScorecards, decision }: KitHeaderProps) {
  return (
    <>
      <PageHeader
        eyebrow={
          <>
            <Link href="/interviews" className="hover:text-ink">
              Interviews
            </Link>{" "}
            /{" "}
            <Link href={`/roles/${role.id}/interviews`} className="hover:text-ink">
              {role.title}
            </Link>
          </>
        }
        title={
          <span className="flex flex-wrap items-center gap-2">
            {candidate.fullName}
            {candidate.isSample && <SampleBadge />}
            <Badge tone={status === "shared" ? "ok" : "neutral"}>{status === "shared" ? "Shared with interviewers" : "Draft plan"}</Badge>
            {decision && <Badge tone="ink">Team decision: {DECISION[decision]}</Badge>}
          </span>
        }
        meta={
          <>
            <span>Interview plan for {role.title}</span>
            <Link href={`/candidates/${candidate.id}?role=${role.id}`} className="underline-offset-2 hover:underline">
              Candidate record
            </Link>
          </>
        }
      />
      <nav aria-label="Interview plan" className="mb-5 flex flex-wrap gap-x-1 border-b border-line">
        <Tab href={`/interviews/${kitId}`} active={active === "plan"} label="Plan & kit" />
        {myScorecards.map((s) => (
          <Tab key={s.id} href={`/interviews/${kitId}/scorecard/${s.id}`} active={active === "scorecard"} label={`My scorecard · ${s.stage}`} hint={s.status === "submitted" ? "submitted" : s.status === "draft" ? "draft" : "to do"} />
        ))}
        <Tab href={`/interviews/${kitId}/debrief`} active={active === "debrief"} label="Debrief" />
      </nav>
    </>
  );
}

function Tab({ href, active, label, hint }: { href: string; active: boolean; label: string; hint?: string }) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={clsx("-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2 text-[13.5px] font-medium", active ? "border-ink text-ink" : "border-transparent text-muted hover:text-ink")}
    >
      {label}
      {hint && <span className="text-[11.5px] font-normal text-faint">{hint}</span>}
    </Link>
  );
}
