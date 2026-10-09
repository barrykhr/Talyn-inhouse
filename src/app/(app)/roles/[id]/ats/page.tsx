import Link from "next/link";
import { Card, EmptyState, Notice, PageHeader, SectionTitle, buttonClass, formatDateTime } from "@/components/ui";
import { getAtsConnector, type AtsJob } from "@/lib/ats/connector";
import { requireAuth } from "@/lib/auth";
import { db } from "@/lib/db";
import { STAGES, STAGE_LABEL } from "@/lib/domain";
import { logError } from "@/lib/log";
import { ownRole } from "@/server/scope";
import { RoleAtsForm } from "./ats-form";

export const metadata = { title: "ATS" };

const OUTBOX_LABEL: Record<string, string> = { pending: "Waiting to push", sent: "Pushed", failed: "Failed — needs attention", skipped: "Not synced" };

export default async function RoleAtsPage({ params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth();
  const { id } = await params;
  const role = await ownRole(auth, id);
  const conn = getAtsConnector();
  const org = await db.organization.findUnique({ where: { id: auth.orgId }, select: { atsLinkedAt: true } });
  const header = <PageHeader eyebrow={<Link href={`/roles/${role.id}`}>← {role.title}</Link>} title="ATS" />;

  if (!conn || !org?.atsLinkedAt)
    return (
      <>
        {header}
        <EmptyState
          title={!conn ? "No ATS connected" : "This workspace isn't linked to the ATS"}
          body={!conn ? "When an ATS is connected, you can link this role to an ATS job and map its stages here." : "A workspace admin can link it in Settings → Integrations."}
          action={
            <Link href="/integrations" className={buttonClass("secondary")}>
              Open integrations
            </Link>
          }
        />
      </>
    );

  let jobs: AtsJob[] = [];
  let stages: string[] = [];
  let error: string | null = null;
  try {
    jobs = await conn.listJobs();
    if (role.atsExternalId) stages = await conn.listStages(role.atsExternalId);
  } catch (err) {
    logError("ats.list_failed", err);
    error = `${conn.label} couldn't be reached. Showing saved settings only.`;
  }
  const maps = await db.atsStageMap.findMany({ where: { orgId: auth.orgId, roleId: role.id } });
  const outbox = await db.atsOutbox.findMany({ where: { orgId: auth.orgId, roleId: role.id }, orderBy: { createdAt: "desc" }, take: 20 });
  const isAdmin = auth.membershipRole === "admin";
  if (role.atsExternalId && !jobs.some((j) => j.externalId === role.atsExternalId)) jobs = [{ externalId: role.atsExternalId, title: `Linked job ${role.atsExternalId}` }, ...jobs];

  return (
    <>
      {header}
      <div className="space-y-5">
        {error && <Notice tone="warn">{error}</Notice>}
        <Card className="p-5">
          <SectionTitle hint={`Connected to ${conn.label}. ${conn.canPushStages ? "Recruiter stage changes are pushed." : "Read-only: stage changes are not pushed (ATS_PUSH_STAGES is off)."}`}>Job and stages</SectionTitle>
          {isAdmin ? (
            <RoleAtsForm
              roleId={role.id}
              jobs={jobs}
              jobId={role.atsExternalId}
              stages={stages}
              talynStages={STAGES.map((s) => ({ key: s, label: STAGE_LABEL[s] }))}
              mapping={Object.fromEntries(maps.map((m) => [m.talynStage, m.atsStage]))}
            />
          ) : (
            <p className="text-[13px] text-ink-2">{role.atsExternalId ? `Linked to ATS job ${role.atsExternalId}.` : "Not linked."} A workspace admin manages this.</p>
          )}
        </Card>
        <Card className="p-5">
          <SectionTitle hint="Stage changes recruiters made in Talyn, and whether the ATS accepted them.">Stage pushes</SectionTitle>
          {outbox.length ? (
            <ul className="divide-y divide-line text-[13px]">
              {outbox.map((o) => (
                <li key={o.id} className="flex flex-wrap justify-between gap-2 py-2">
                  <span>
                    {STAGE_LABEL[o.talynStage as keyof typeof STAGE_LABEL] ?? o.talynStage}
                    {o.atsStage ? ` → ${o.atsStage}` : ""} · {o.createdByName} · {formatDateTime(o.createdAt)}
                  </span>
                  <span className={o.status === "failed" ? "text-danger" : o.status === "sent" ? "text-ok" : "text-muted"}>
                    {OUTBOX_LABEL[o.status]}
                    {o.lastError ? ` — ${o.lastError}` : ""}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[13px] text-muted">No stage changes pushed yet.</p>
          )}
        </Card>
      </div>
    </>
  );
}
