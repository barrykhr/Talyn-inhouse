import clsx from "clsx";
import Link from "next/link";
import { RoleStatusBadge } from "@/components/status";
import { Card, EmptyState, LinkButton, PageHeader } from "@/components/ui";
import { requireAuth } from "@/lib/auth";
import { db } from "@/lib/db";
import { EMPLOYMENT_TYPE_LABEL, ROLE_STATUSES, ROLE_STATUS_LABEL, type EmploymentType } from "@/lib/domain";

export const metadata = { title: "Roles" };

export default async function RolesPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const auth = await requireAuth();
  const { status } = await searchParams;
  const filter = ROLE_STATUSES.includes(status as never) ? status : undefined;

  const [roles, counts] = await Promise.all([
    db.role.findMany({
      where: { orgId: auth.orgId, ...(filter ? { status: filter } : {}) },
      include: {
        criteria: { select: { status: true } },
        applications: { select: { stage: true } },
      },
      orderBy: { updatedAt: "desc" },
    }),
    db.role.groupBy({ by: ["status"], where: { orgId: auth.orgId }, _count: true }),
  ]);
  const total = counts.reduce((n, c) => n + c._count, 0);

  return (
    <>
      <PageHeader title="Roles" meta={<span>{total} total</span>} actions={<LinkButton href="/roles/new" variant="primary">New role</LinkButton>} />

      {total > 0 && (
        <div className="mb-4 flex flex-wrap gap-1">
          {[undefined, ...ROLE_STATUSES].map((s) => {
            const n = s ? counts.find((c) => c.status === s)?._count ?? 0 : total;
            return (
              <Link
                key={s ?? "all"}
                href={s ? `/roles?status=${s}` : "/roles"}
                className={clsx(
                  "rounded-lg px-2.5 py-1 text-[13px] font-medium",
                  filter === s ? "bg-ink text-white" : "text-muted hover:bg-sunken hover:text-ink",
                )}
              >
                {s ? ROLE_STATUS_LABEL[s] : "All"} <span className="opacity-60">{n}</span>
              </Link>
            );
          })}
        </div>
      )}

      {total === 0 ? (
        <EmptyState
          title="No roles yet"
          body="Create a role, paste the job description, and turn its requirements into criteria you can assess candidates against."
          action={<LinkButton href="/roles/new" variant="primary">Create your first role</LinkButton>}
        />
      ) : roles.length === 0 ? (
        <EmptyState title="No roles with this status" />
      ) : (
        <div className="grid gap-2">
          {roles.map((r) => {
            const approved = r.criteria.filter((c) => c.status === "approved").length;
            const proposed = r.criteria.filter((c) => c.status === "proposed").length;
            const active = r.applications.filter((a) => a.stage !== "rejected" && a.stage !== "hired").length;
            const fresh = r.applications.filter((a) => a.stage === "new").length;
            return (
              <Link key={r.id} href={`/roles/${r.id}`} className="group">
                <Card className="flex flex-wrap items-center gap-x-6 gap-y-2 px-5 py-4 transition-colors group-hover:border-line-strong">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-[15px] font-semibold tracking-tight">{r.title}</span>
                      <RoleStatusBadge status={r.status} />
                    </div>
                    <div className="mt-0.5 truncate text-[13px] text-muted">
                      {[r.department, r.location, EMPLOYMENT_TYPE_LABEL[r.employmentType as EmploymentType]].filter(Boolean).join(" · ")}
                    </div>
                  </div>
                  <Stat label="Criteria" value={approved} note={proposed ? `${proposed} to review` : approved === 0 ? "none yet" : undefined} warn={proposed > 0 || approved === 0} />
                  <Stat label="Active" value={active} note={fresh ? `${fresh} new` : undefined} />
                  <Stat label="Total" value={r.applications.length} />
                </Card>
              </Link>
            );
          })}
        </div>
      )}
    </>
  );
}

function Stat({ label, value, note, warn }: { label: string; value: number; note?: string; warn?: boolean }) {
  return (
    <div className="w-24 text-right">
      <div className="text-[15px] font-semibold tabular-nums">{value}</div>
      <div className="text-[12px] text-muted">
        {label}
        {note && <span className={warn ? " text-warn" : ""}> · {note}</span>}
      </div>
    </div>
  );
}
