import clsx from "clsx";
import Link from "next/link";
import { OriginBadge, SampleBadge } from "@/components/role-workspace";
import { Badge, Breadcrumbs, Card, EmptyState, PageHeader, formatDate } from "@/components/ui";
import { requireAuth } from "@/lib/auth";
import { db } from "@/lib/db";
import { CONFIDENCE_LABEL, DUP_STATUS_LABEL, scanDuplicates } from "@/lib/duplicates";
import { DuplicateDecision } from "./decision";

export const metadata = { title: "Possible duplicates" };

const STATUSES = ["open", "deferred", "linked", "dismissed"] as const;
const SOURCE_LABEL: Record<string, string> = { manual: "Added by recruiter", csv: "CSV import", cv_upload: "CV upload", ats: "ATS", sample: "Sample data" };

/** Possible duplicate records, compared side by side. Suggestions only — nothing is merged or deleted. */
export default async function DuplicatesPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const auth = await requireAuth();
  const { status: sp } = await searchParams;
  const status = (STATUSES as readonly string[]).includes(sp ?? "") ? sp! : "open";
  await scanDuplicates(auth.orgId);
  const [counts, reviews] = await Promise.all([
    db.duplicateReview.groupBy({ by: ["status"], where: { orgId: auth.orgId }, _count: true }),
    db.duplicateReview.findMany({ where: { orgId: auth.orgId, status }, orderBy: [{ confidence: "asc" }, { createdAt: "desc" }], take: 100 }),
  ]);
  const ids = [...new Set(reviews.flatMap((r) => [r.candidateAId, r.candidateBId]))];
  const cands = await db.candidate.findMany({
    where: { orgId: auth.orgId, id: { in: ids } },
    select: {
      id: true,
      fullName: true,
      email: true,
      phone: true,
      linkedinUrl: true,
      currentTitle: true,
      currentCompany: true,
      location: true,
      source: true,
      isSample: true,
      createdAt: true,
      _count: { select: { resumes: true, notes: true } },
      applications: { select: { id: true, origin: true, originDetail: true, stage: true, role: { select: { id: true, title: true } } } },
    },
  });
  type Cand = (typeof cands)[number];
  const byId = new Map(cands.map((c) => [c.id, c]));
  const order = { high: 0, medium: 1, low: 2 } as Record<string, number>;
  reviews.sort((a, b) => (order[a.confidence] ?? 3) - (order[b.confidence] ?? 3));
  const n = (s: string) => counts.find((c) => c.status === s)?._count ?? 0;

  return (
    <>
      <PageHeader
        eyebrow={<Breadcrumbs items={[{ label: "Candidates", href: "/candidates" }, { label: "Possible duplicates" }]} />}
        title="Possible duplicates"
        meta={<span>Suggestions only. Confirming a match links the two records — both stay, with their own roles, assessments, interviews and outreach. Any decision can be undone.</span>}
      />
      <nav className="mb-4 flex flex-wrap gap-1 text-[13px]" aria-label="Filter by decision">
        {STATUSES.map((s) => (
          <Link
            key={s}
            href={`/candidates/duplicates?status=${s}`}
            aria-current={status === s ? "page" : undefined}
            className={clsx("rounded-lg px-2.5 py-1 font-medium", status === s ? "bg-ink text-white" : "text-muted hover:bg-sunken hover:text-ink")}
          >
            {DUP_STATUS_LABEL[s].split(" — ")[0].split(" (")[0]} <span className="opacity-60">{n(s)}</span>
          </Link>
        ))}
      </nav>
      {reviews.length === 0 ? (
        <EmptyState
          title={status === "open" ? "No possible duplicates to review" : "Nothing here"}
          body={status === "open" ? "Talyn compares normalized email, phone, profile URL, and name with company. Name-only matches are listed as uncertain." : undefined}
        />
      ) : (
        <div className="space-y-3">
          {reviews.map((r) => {
            const a = byId.get(r.candidateAId);
            const b = byId.get(r.candidateBId);
            if (!a || !b) return null;
            const reasons = JSON.parse(r.reasonsJson) as string[];
            const rows: [string, (c: Cand) => React.ReactNode][] = [
              ["Email", (c) => c.email ?? "—"],
              ["Phone", (c) => c.phone ?? "—"],
              ["Profile URL", (c) => c.linkedinUrl ?? "—"],
              ["Current role", (c) => [c.currentTitle, c.currentCompany].filter(Boolean).join(" · ") || "—"],
              ["Location", (c) => c.location ?? "—"],
              ["Added", (c) => `${formatDate(c.createdAt)} · ${SOURCE_LABEL[c.source] ?? (c.source.startsWith("sourced:") ? `Discover · ${c.source.slice(8)}` : c.source)}`],
              ["Material", (c) => `${c._count.resumes} CV${c._count.resumes === 1 ? "" : "s"} · ${c._count.notes} note${c._count.notes === 1 ? "" : "s"}`],
              [
                "Roles",
                (c) =>
                  c.applications.length ? (
                    <span className="flex flex-wrap gap-1">
                      {c.applications.map((ap) => (
                        <span key={ap.id} className="inline-flex items-center gap-1">
                          <OriginBadge origin={ap.origin} detail={ap.originDetail} />
                          <Link href={`/roles/${ap.role.id}`} className="hover:underline">
                            {ap.role.title}
                          </Link>
                        </span>
                      ))}
                    </span>
                  ) : (
                    "None"
                  ),
              ],
            ];
            return (
              <Card key={r.id} className="overflow-hidden">
                <div className="flex flex-wrap items-center gap-2 border-b border-line bg-[#fbfaf8] px-4 py-2.5 text-[13px]">
                  <Badge tone={r.confidence === "high" ? "warn" : r.confidence === "medium" ? "neutral" : "neutral"} title="How strong the match signal is">
                    {CONFIDENCE_LABEL[r.confidence]}
                  </Badge>
                  <span className="text-ink-2">{reasons.join(" · ")}</span>
                  {r.status !== "open" && (
                    <span className="ml-auto text-[12px] text-muted">
                      {DUP_STATUS_LABEL[r.status]}
                      {r.decidedByName ? ` by ${r.decidedByName}` : ""}
                      {r.decidedAt ? ` · ${formatDate(r.decidedAt)}` : ""}
                      {r.note ? ` · “${r.note}”` : ""}
                    </span>
                  )}
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-[13px]">
                    <thead>
                      <tr className="text-left">
                        <th className="w-32 px-4 py-2 font-medium text-muted"> </th>
                        {[a, b].map((c) => (
                          <th key={c.id} className="px-4 py-2 font-semibold">
                            <Link href={`/candidates/${c.id}`} className="hover:underline">
                              {c.fullName}
                            </Link>
                            {c.isSample && <SampleBadge className="ml-1.5" />}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-line">
                      {rows.map(([label, get]) => (
                        <tr key={label}>
                          <td className="px-4 py-1.5 text-muted">{label}</td>
                          <td className="px-4 py-1.5">{get(a)}</td>
                          <td className="px-4 py-1.5">{get(b)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="border-t border-line px-4 py-3">
                  <DuplicateDecision id={r.id} status={r.status} />
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </>
  );
}
