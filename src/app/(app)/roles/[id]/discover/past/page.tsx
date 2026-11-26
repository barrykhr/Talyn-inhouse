import Link from "next/link";
import { ActionButton } from "@/components/client";
import { Breadcrumbs, Card, EmptyState, PageHeader } from "@/components/ui";
import { requireAuth } from "@/lib/auth";
import { db } from "@/lib/db";
import { embeddingStatus } from "@/lib/semantic/embed";
import { pastCandidatesFor } from "@/server/past-candidates";
import { ownRole } from "@/server/scope";
import { addPastCandidate } from "@/server/sourcing-actions";

export const metadata = { title: "Past candidates" };
export const maxDuration = 60;

/** People who got far for another role and weren't hired: worth another look for this one. */
export default async function PastCandidatesPage({ params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth();
  const { id } = await params;
  const role = await ownRole(auth, id);
  const criteria = await db.criterion.findMany({ where: { orgId: auth.orgId, roleId: id, status: "approved" }, select: { name: true } });
  const list = await pastCandidatesFor(auth.orgId, role, criteria.map((c) => c.name));
  const meaning = embeddingStatus().configured;
  return (
    <>
      <PageHeader
        eyebrow={<Breadcrumbs items={[{ label: "Roles", href: "/roles" }, { label: role.title, href: `/roles/${role.id}` }, { label: "Discover", href: `/roles/${role.id}/discover` }, { label: "Past candidates" }]} />}
        title="Past candidates worth another look"
        meta={
          <span className="text-[13px] text-muted">
            People who were shortlisted or reached the hiring team for another role and weren&apos;t hired. {meaning ? "Closest in meaning to this role first." : "Furthest along first."} Their details are as they were then; nothing is refreshed or contacted.
          </span>
        }
      />
      {list.length === 0 ? (
        <EmptyState title="No past candidates yet" body="When people get far for other roles without being hired, they show up here for new roles." />
      ) : (
        <Card className="divide-y divide-line overflow-hidden">
          {list.map((p) => (
            <div key={p.candidateId} className="motion-row flex flex-wrap items-start justify-between gap-3 px-4 py-3">
              <div className="min-w-0">
                <Link href={`/candidates/${p.candidateId}`} className="font-medium hover:underline">
                  {p.name}
                </Link>
                {p.headline && <p className="text-[12.5px] text-muted">{p.headline}</p>}
                <ul className="mt-1 text-[12.5px] text-ink-2">
                  {p.reasons.map((r) => (
                    <li key={r}>· {r}</li>
                  ))}
                </ul>
              </div>
              <ActionButton action={addPastCandidate.bind(null, role.id, p.candidateId, p.reasons[0] ?? "")} variant="secondary">
                Add to this role
              </ActionButton>
            </div>
          ))}
        </Card>
      )}
      <p className="mt-3 text-[12px] text-faint">Adding someone puts them in this role as found by your team. They reach the hiring manager only after they confirm interest.</p>
    </>
  );
}
