import clsx from "clsx";
import Link from "next/link";
import { EvidenceCounts, ModeBanner, OriginBadge, SampleBadge } from "@/components/role-workspace";
import { ReviewActions } from "@/components/review-actions";
import { StageSelect } from "@/components/stage-select";
import { Card, EmptyState, LinkButton, formatDate } from "@/components/ui";
import { evidenceCounts } from "@/lib/review-status";
import type { AppRow } from "./applicants";

/** Everyone the recruiter shortlisted for this role, from either workflow, with their origin kept visible. */
export function ShortlistTab({ roleId, shortlisted, origin }: { roleId: string; shortlisted: AppRow[]; origin: string }) {
  const rows = shortlisted.filter((a) => !origin || a.origin === origin).sort((x, y) => (y.decidedAt?.getTime() ?? 0) - (x.decidedAt?.getTime() ?? 0));
  const n = (o: string) => shortlisted.filter((a) => a.origin === o).length;
  return (
    <div className="space-y-4">
      <ModeBanner mode="shortlist">
        People you want to progress — applicants you shortlisted and people you saved from Discover. Each keeps its origin. Stages still move only when you change them.
      </ModeBanner>

      <nav aria-label="Filter shortlist by origin" className="flex flex-wrap gap-1 text-[13px]">
        {(
          [
            ["", `All ${shortlisted.length}`],
            ["applied", `Applied ${n("applied")}`],
            ["discovered", `Discovered ${n("discovered")}`],
          ] as const
        ).map(([k, label]) => (
          <Link
            key={k}
            href={`/roles/${roleId}?tab=shortlist${k ? `&origin=${k}` : ""}`}
            aria-current={origin === k ? "page" : undefined}
            className={clsx("rounded-lg px-2.5 py-1 font-medium", origin === k ? "bg-ink text-white" : "text-muted hover:bg-sunken hover:text-ink")}
          >
            {label}
          </Link>
        ))}
      </nav>

      {shortlisted.length === 0 ? (
        <EmptyState
          title="No one shortlisted yet"
          body="Shortlist applicants from the Applicants tab, or save people you find in Discover — both appear here with where they came from."
          action={
            <>
              <LinkButton href={`/roles/${roleId}?tab=applicants`}>Review applicants</LinkButton>
              <LinkButton href={`/roles/${roleId}/discover`}>Discover candidates</LinkButton>
            </>
          }
        />
      ) : rows.length === 0 ? (
        <EmptyState title={`No ${origin === "applied" ? "applicants" : "discovered people"} on the shortlist`} action={<LinkButton href={`/roles/${roleId}?tab=shortlist`}>Show all</LinkButton>} />
      ) : (
        <Card className="overflow-hidden">
          <ul className="divide-y divide-line">
            {rows.map((a) => {
              const latest = a.assessments[0];
              return (
                <li key={a.id} className={`${a.decidedAt && Date.now() - a.decidedAt.getTime() < 60_000 ? "motion-flash " : ""}grid gap-x-4 gap-y-2 px-4 py-3 lg:grid-cols-[minmax(0,1.5fr)_150px_minmax(0,1fr)_auto] lg:items-center`}>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Link href={`/candidates/${a.candidate.id}?role=${roleId}`} className="font-medium hover:underline">
                        {a.candidate.fullName}
                      </Link>
                      <OriginBadge origin={a.origin} detail={a.originDetail} />
                      {a.candidate.isSample && <SampleBadge />}
                    </div>
                    <div className="truncate text-[12.5px] text-muted">
                      {[a.candidate.currentTitle, a.candidate.currentCompany].filter(Boolean).join(" · ") || <span className="text-faint">No current role on record</span>}
                    </div>
                    <div className="text-[11.5px] text-faint">
                      {a.origin === "discovered" ? `${a.originDetail ?? "Discovered"} · ${formatDate(a.createdAt)}` : `Applied ${formatDate(a.createdAt)}`}
                      {a.decidedAt ? ` · shortlisted ${formatDate(a.decidedAt)}${a.decidedByName ? ` by ${a.decidedByName}` : ""}` : ""}
                    </div>
                  </div>
                  <StageSelect applicationId={a.id} stage={a.stage} />
                  <div>
                    {latest ? (
                      <EvidenceCounts counts={evidenceCounts(latest.items)} />
                    ) : (
                      <span className="text-[12.5px] text-faint">
                        Not assessed —{" "}
                        <Link href={`/candidates/${a.candidate.id}?role=${roleId}`} className="underline hover:text-ink">
                          open to assess
                        </Link>
                      </span>
                    )}
                  </div>
                  <div className="lg:justify-self-end">
                    <ReviewActions applicationId={a.id} decision={a.decision} name={a.candidate.fullName} compact allowClear />
                  </div>
                </li>
              );
            })}
          </ul>
        </Card>
      )}
    </div>
  );
}
