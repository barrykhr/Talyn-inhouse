import Link from "next/link";
import { ActivityList, parseMeta } from "@/components/activity";
import { Card, PageHeader, Select, buttonClass } from "@/components/ui";
import { AUDIT_LABEL } from "@/lib/audit";
import { requireAuth } from "@/lib/auth";
import { db } from "@/lib/db";

export const metadata = { title: "Audit log" };

export default async function AuditPage({ searchParams }: { searchParams: Promise<{ action?: string; before?: string }> }) {
  const auth = await requireAuth();
  if (auth.membershipRole !== "admin")
    return <p className="text-[13px] text-muted">Only workspace admins can view the audit log.</p>;
  const { action, before } = await searchParams;
  const events = await db.auditEvent.findMany({
    where: { orgId: auth.orgId, ...(action ? { action } : {}), ...(before ? { createdAt: { lt: new Date(before) } } : {}) },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  const [cands, roles] = await Promise.all([
    db.candidate.findMany({ where: { orgId: auth.orgId, id: { in: events.map((e) => e.candidateId).filter((x): x is string => !!x) } }, select: { id: true, fullName: true } }),
    db.role.findMany({ where: { orgId: auth.orgId, id: { in: events.map((e) => e.roleId).filter((x): x is string => !!x) } }, select: { id: true, title: true } }),
  ]);
  const cname = new Map(cands.map((c) => [c.id, c.fullName]));
  const rname = new Map(roles.map((r) => [r.id, r.title]));
  const last = events[events.length - 1];
  return (
    <div className="max-w-4xl">
      <PageHeader eyebrow={<Link href="/settings" className="hover:text-ink">Settings</Link>} title="Audit log" meta={<span>Most recent first. Deleted candidates appear by id only.</span>} />
      <form className="mb-4 flex gap-2">
        <Select name="action" defaultValue={action ?? ""} className="w-auto">
          <option value="">All actions</option>
          {Object.entries(AUDIT_LABEL).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </Select>
        <button className={buttonClass("secondary")}>Filter</button>
      </form>
      <Card className="p-4">
        <ActivityList
          showSubject
          rows={events.map((e) => ({
            id: e.id,
            action: e.action,
            actorName: e.actorName,
            createdAt: e.createdAt,
            meta: parseMeta(e.metaJson),
            subject: [e.candidateId ? (cname.get(e.candidateId) ?? `candidate ${e.candidateId.slice(-6)} (deleted)`) : null, e.roleId ? (rname.get(e.roleId) ?? "deleted role") : null]
              .filter(Boolean)
              .join(" · "),
          }))}
        />
        {events.length === 100 && last && (
          <Link href={`/settings/audit?${new URLSearchParams({ ...(action ? { action } : {}), before: last.createdAt.toISOString() })}`} className={buttonClass("ghost", "sm", "mt-3")}>
            Older →
          </Link>
        )}
      </Card>
    </div>
  );
}
