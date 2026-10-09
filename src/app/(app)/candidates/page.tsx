import Link from "next/link";
import { StageBadge } from "@/components/status";
import { OriginBadge, SampleBadge } from "@/components/role-workspace";
import { Card, EmptyState, Input, LinkButton, PageHeader, Select, buttonClass, formatDate } from "@/components/ui";
import { requireAuth } from "@/lib/auth";
import { scanDuplicates } from "@/lib/duplicates";
import { db } from "@/lib/db";

export const metadata = { title: "Candidates" };

export default async function CandidatesPage({ searchParams }: { searchParams: Promise<{ q?: string; role?: string }> }) {
  const auth = await requireAuth();
  const { q = "", role = "" } = await searchParams;
  const query = q.trim().slice(0, 100);

  const [candidates, total, roles] = await Promise.all([
    db.candidate.findMany({
      where: {
        orgId: auth.orgId,
        ...(query
          ? {
              OR: [
                { fullName: { contains: query, mode: "insensitive" as const } },
                { email: { contains: query, mode: "insensitive" as const } },
                { currentTitle: { contains: query, mode: "insensitive" as const } },
                { currentCompany: { contains: query, mode: "insensitive" as const } },
              ],
            }
          : {}),
        ...(role ? { applications: { some: { roleId: role } } } : {}),
      },
      include: {
        applications: { include: { role: { select: { id: true, title: true } } } },
        _count: { select: { resumes: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 200,
    }),
    db.candidate.count({ where: { orgId: auth.orgId } }),
    db.role.findMany({ where: { orgId: auth.orgId }, select: { id: true, title: true }, orderBy: { title: "asc" } }),
  ]);

  await scanDuplicates(auth.orgId).catch(() => 0);
  const openDuplicates = await db.duplicateReview.count({ where: { orgId: auth.orgId, status: "open" } });
  return (
    <>
      <PageHeader
        title="Candidates"
        meta={<span>{total} in workspace</span>}
        actions={
          <>
            {openDuplicates > 0 && (
              <LinkButton href="/candidates/duplicates" variant="ghost">
                Possible duplicates ({openDuplicates})
              </LinkButton>
            )}
            <LinkButton href="/import">Import CSV</LinkButton>
            <LinkButton href="/candidates/new" variant="primary">New candidate</LinkButton>
          </>
        }
      />

      {total === 0 ? (
        <EmptyState
          title="No candidates yet"
          body="Candidates appear here when someone applies, when you save a person from Discover, or when you add or import them. Each keeps where they came from."
          action={
            <>
              <LinkButton href="/candidates/new" variant="primary">Add candidate</LinkButton>
              <LinkButton href="/import">Import CSV</LinkButton>
              <LinkButton href="/discover">Start a search</LinkButton>
            </>
          }
        />
      ) : (
        <>
          <form className="mb-4 flex flex-wrap gap-2" role="search">
            <Input name="q" defaultValue={query} placeholder="Search name, email, title, company" className="max-w-xs" />
            <Select name="role" defaultValue={role} className="max-w-56">
              <option value="">All roles</option>
              {roles.map((r) => (
                <option key={r.id} value={r.id}>{r.title}</option>
              ))}
            </Select>
            <button className={buttonClass("secondary")}>Filter</button>
            {(query || role) && <LinkButton href="/candidates" variant="ghost">Clear</LinkButton>}
          </form>

          {candidates.length === 0 ? (
            <EmptyState title="No matching candidates" />
          ) : (
            <Card className="divide-y divide-line overflow-hidden">
              {candidates.map((c) => (
                <Link key={c.id} href={`/candidates/${c.id}`} className="flex flex-wrap items-center gap-x-6 gap-y-1.5 px-5 py-3 hover:bg-[#fbfaf8]">
                  <div className="min-w-0 flex-1 basis-56">
                    <div className="flex items-center gap-1.5 font-medium">
                      {c.fullName}
                      {c.isSample && <SampleBadge />}
                      {c.extractionStatus === "needs_review" && <span className="rounded-md bg-signal-soft px-1.5 text-[11px] font-semibold text-signal">CV review pending</span>}
                    </div>
                    <div className="truncate text-[12.5px] text-muted">
                      {[c.currentTitle, c.currentCompany].filter(Boolean).join(" · ") || c.email || "—"}
                    </div>
                  </div>
                  <div className="flex min-w-0 flex-1 basis-64 flex-wrap gap-1.5">
                    {c.applications.length === 0 ? (
                      <span className="text-[12.5px] text-faint">Not in a role</span>
                    ) : (
                      c.applications.map((a) => (
                        <span key={a.id} className="inline-flex items-center gap-1 text-[12.5px]">
                          <OriginBadge origin={a.origin} detail={a.originDetail} />
                          <span className="max-w-40 truncate text-ink-2">{a.role.title}</span>
                          <StageBadge stage={a.stage} />
                        </span>
                      ))
                    )}
                  </div>
                  <div className="w-36 text-right text-[12.5px] text-muted">
                    {c._count.resumes ? "Resume on file" : <span className="text-warn">No resume</span>}
                    <div className="text-faint">Added {formatDate(c.createdAt)}</div>
                  </div>
                </Link>
              ))}
            </Card>
          )}
        </>
      )}
    </>
  );
}
