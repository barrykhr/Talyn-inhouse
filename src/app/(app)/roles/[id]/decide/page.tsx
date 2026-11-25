import clsx from "clsx";
import Link from "next/link";
import { ProfileScoreChip } from "@/components/profile-score";
import { SampleBadge } from "@/components/role-workspace";
import { Breadcrumbs, EmptyState, PageHeader } from "@/components/ui";
import { requireAuth } from "@/lib/auth";
import { bestQuote, relevanceBullets, truncate } from "@/lib/candidate-summary";
import { db } from "@/lib/db";
import { DECISION_LABEL, type Decision } from "@/lib/domain";
import { parseEvidence } from "@/lib/evidence";
import { ownRole } from "@/server/scope";
import { ReviewControls } from "./review-keys";

export const metadata = { title: "Review mode" };

const STATUS: Record<string, { label: string; cls: string }> = {
  supported: { label: "Found", cls: "bg-ok-soft text-ok" },
  partially_supported: { label: "Partial", cls: "bg-warn-soft text-warn" },
  inferred: { label: "Check", cls: "bg-warn-soft text-warn" },
  conflicting: { label: "Conflicting", cls: "bg-danger-soft text-danger" },
  not_stated: { label: "Gap", cls: "bg-sunken text-muted" },
  confirmed_absent: { label: "Absent", cls: "bg-sunken text-muted" },
};

/**
 * Review mode: one candidate at a time, evidence first, decide with S / H / R, move with ← →.
 * "Undecided" (default) lists active candidates with no decision, highest profile score first;
 * a decided candidate leaves the list, so the next one slides into place.
 */
export default async function ReviewModePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ i?: string; scope?: string; d?: string }> }) {
  const auth = await requireAuth();
  const { id } = await params;
  const { i: iParam = "0", scope: scopeParam, d } = await searchParams;
  const scope = scopeParam === "all" ? "all" : "undecided";
  const role = await ownRole(auth, id);
  const apps = await db.application.findMany({
    where: { orgId: auth.orgId, roleId: id, stage: { notIn: ["hired", "rejected"] }, ...(scope === "undecided" ? { decision: null } : {}) },
    select: {
      id: true,
      decision: true,
      createdAt: true,
      candidate: { select: { id: true, fullName: true, currentTitle: true, currentCompany: true, location: true, isSample: true } },
      assessments: { orderBy: { createdAt: "desc" }, take: 1, select: { id: true, items: { select: { criterionName: true, kind: true, importance: true, result: true, overrideResult: true, evidenceJson: true } } } },
      profileScores: { orderBy: { createdAt: "desc" }, take: 1, include: { scoringVersion: { select: { version: true } } } },
    },
    take: 300,
  });
  const scoreOf = (a: (typeof apps)[number]) => {
    const p = a.profileScores[0];
    return p && a.assessments[0] && p.assessmentId === a.assessments[0].id && p.score !== null ? p.score : -1;
  };
  const ordered = [...apps].sort((a, b) => scoreOf(b) - scoreOf(a) || a.createdAt.getTime() - b.createdAt.getTime());
  const total = ordered.length;
  const index = Math.max(0, Math.min(total - 1, Number(iParam) || 0));
  const a = ordered[index];

  const header = (
    <PageHeader
      eyebrow={<Breadcrumbs items={[{ label: "Roles", href: "/roles" }, { label: role.title, href: `/roles/${role.id}?tab=applicants` }, { label: "Review mode" }]} />}
      title="Review mode"
      meta={
        <span className="flex flex-wrap items-center gap-2">
          {(["undecided", "all"] as const).map((s) => (
            <Link key={s} href={`/roles/${role.id}/decide?scope=${s}`} aria-current={scope === s ? "page" : undefined} className={clsx("rounded-md px-2 py-0.5 text-[12.5px] font-medium", scope === s ? "bg-ink text-white" : "text-muted hover:bg-sunken hover:text-ink")}>
              {s === "undecided" ? "No decision yet" : "Everyone active"}
            </Link>
          ))}
        </span>
      }
    />
  );

  if (!a)
    return (
      <>
        {header}
        <EmptyState
          title={scope === "undecided" ? "Every active candidate has a decision" : "No active candidates"}
          body={scope === "undecided" ? "Nothing left to review here. Switch to “Everyone active” to revisit decisions." : "Add applicants or save people from Discover first."}
          action={<Link href={`/roles/${role.id}?tab=applicants`} className="font-medium underline">Back to applicants</Link>}
        />
      </>
    );

  const latest = a.assessments[0];
  const items = (latest?.items ?? []).filter((x) => x.importance !== "informational");
  const result = (x: (typeof items)[number]) => x.overrideResult ?? x.result;
  const criteria = items.filter((x) => x.kind !== "skill").sort((x, y) => Number(x.importance === "preferred") - Number(y.importance === "preferred"));
  const bullets = relevanceBullets(items.filter((x) => x.kind === "skill"));
  const p = a.profileScores[0];
  const valid = p && latest && p.assessmentId === latest.id;

  return (
    <>
      {header}
      <div className="mb-3 flex items-center gap-3 text-[13px]">
        <span className="font-semibold tabular-nums">
          {index + 1} of {total}
        </span>
        <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-sunken" aria-hidden>
          <span className="block h-full rounded-full bg-brand transition-[width] duration-300" style={{ width: `${((index + 1) / total) * 100}%` }} />
        </span>
        <span className="text-muted">{scope === "undecided" ? "highest score first" : "everyone active"}</span>
      </div>

      <article key={a.id} className={clsx("rounded-2xl border border-line bg-surface p-5 shadow-[0_8px_24px_-16px_rgba(16,24,40,0.18)]", d === "prev" ? "motion-slide-prev" : "motion-slide-next")} aria-labelledby="rm-name">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 id="rm-name" className="flex flex-wrap items-center gap-2 text-[20px] font-semibold tracking-tight">
              {a.candidate.fullName} {a.candidate.isSample && <SampleBadge />}
            </h2>
            <p className="text-[13.5px] text-muted">{[a.candidate.currentTitle, a.candidate.currentCompany, a.candidate.location].filter(Boolean).join(" · ") || "No current role on file"}</p>
          </div>
          <div className="flex items-center gap-2">
            <ProfileScoreChip
              s={valid ? { id: p.id, score: p.score, coverage: p.coverage, status: p.status, band: p.band, bandLabel: p.bandLabel, version: p.scoringVersion.version, currentVersion: p.scoringVersion.version, createdAt: p.createdAt, createdByName: p.createdByName, trigger: p.trigger } : null}
            />
            {a.decision && <span className="rounded-md bg-sunken px-2 py-0.5 text-[12px] font-medium">Now: {DECISION_LABEL[a.decision as Decision]}</span>}
          </div>
        </div>

        {bullets.length > 0 && (
          <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[13px] text-ink-2">
            {bullets.map((b) => (
              <li key={b}>· {b}</li>
            ))}
          </ul>
        )}

        <div className="mt-4">
          {!latest ? (
            <p className="rounded-lg bg-sunken px-3 py-3 text-[13px] text-muted">Not assessed yet. Open the full profile to assess, or decide from what you know.</p>
          ) : (
            <ul className="divide-y divide-line rounded-xl border border-line">
              {criteria.map((x, k) => {
                const st = STATUS[result(x)] ?? STATUS.not_stated;
                const q = bestQuote(parseEvidence(x.evidenceJson));
                return (
                  <li key={k} className="flex items-start gap-3 px-3 py-2">
                    <span className={clsx("mt-0.5 w-[86px] shrink-0 rounded px-1.5 py-px text-center text-[11.5px] font-semibold", st.cls)}>{st.label}</span>
                    <div className="min-w-0 flex-1">
                      <p className="text-[13.5px] font-medium">
                        {x.criterionName}
                        {x.importance === "preferred" && <span className="ml-1.5 text-[11.5px] font-normal text-faint">preferred</span>}
                      </p>
                      {q ? <p className="quote text-[12.5px] text-ink-2">“{truncate(q.quote, 160)}”</p> : <p className="text-[12.5px] text-muted">No evidence in the material</p>}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
        <div className="mt-3 text-right">
          <Link href={`/candidates/${a.candidate.id}?role=${role.id}`} className="text-[12.5px] font-medium text-brand hover:underline">
            Open full profile →
          </Link>
        </div>
      </article>

      <div className="sticky bottom-0 z-10 -mx-1 mt-4 border-t border-line bg-paper/95 px-1 pb-3 pt-3 backdrop-blur">
        <ReviewControls applicationId={a.id} roleId={role.id} index={index} total={total} scope={scope} current={a.decision} />
      </div>
    </>
  );
}
