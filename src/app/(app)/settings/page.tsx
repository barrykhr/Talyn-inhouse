import Link from "next/link";
import { Badge, Card, PageHeader, SectionTitle, buttonClass } from "@/components/ui";
import { eligibleForRetention } from "@/lib/retention";
import { RetentionForm } from "./retention";
import { PROVIDER_LABEL, aiStatus } from "@/lib/ai";
import { requireAuth } from "@/lib/auth";
import { db } from "@/lib/db";
import { DeleteOrg } from "./delete-org";

export const metadata = { title: "Settings" };

export default async function SettingsPage() {
  const auth = await requireAuth();
  const ai = aiStatus();
  const org = await db.organization.findUniqueOrThrow({ where: { id: auth.orgId }, select: { retentionDays: true } });
  const eligible = org.retentionDays ? (await eligibleForRetention(auth.orgId, org.retentionDays)).length : null;
  const [roles, candidates, members] = await Promise.all([
    db.role.count({ where: { orgId: auth.orgId } }),
    db.candidate.count({ where: { orgId: auth.orgId } }),
    db.membership.findMany({ where: { orgId: auth.orgId }, include: { user: { select: { name: true, email: true } } } }),
  ]);
  return (
    <div className="max-w-3xl space-y-5">
      <PageHeader title="Settings" />

      <Card className="p-5">
        <SectionTitle>Workspace</SectionTitle>
        <dl className="grid grid-cols-[140px_1fr] gap-y-2 text-[13px]">
          <dt className="text-muted">Organization</dt>
          <dd className="font-medium">{auth.orgName}</dd>
          <dt className="text-muted">Data</dt>
          <dd>{roles} roles · {candidates} candidates</dd>
          <dt className="text-muted">Members</dt>
          <dd className="space-y-0.5">
            {members.map((m) => (
              <div key={m.id}>{m.user.name} <span className="text-muted">· {m.user.email} · {m.role}</span></div>
            ))}
          </dd>
        </dl>
      </Card>

      <Card className="p-5">
        <SectionTitle>AI assist</SectionTitle>
        <div className="mb-3 flex flex-wrap items-center gap-2 text-[13px]">
          {ai.configured ? <Badge tone="ok">On</Badge> : <Badge>Off</Badge>}
          {ai.configured && ai.provider && (
            <span className="text-muted">
              {PROVIDER_LABEL[ai.provider]} · <span className="font-mono text-[12px]">{ai.model}</span>
            </span>
          )}
        </div>
        <div className="space-y-2 text-[13px] text-ink-2">
          <p>
            AI proposes role criteria from job descriptions and assesses candidates against approved criteria, citing evidence. It never moves, hides or rejects
            candidates; every stage change and decision is made by a recruiter.
          </p>
          {!ai.configured && (
            <p>
              To turn it on, add <code className="font-mono">OPENAI_API_KEY</code> (OpenAI) or <code className="font-mono">ANTHROPIC_API_KEY</code> (Anthropic) to
              your hosting environment variables and redeploy. Without a key you can still add criteria manually, extract them from JD bullet points, and run
              keyword checks — these are always labeled as non-AI.
            </p>
          )}
          <p className="text-muted">
            What is sent to the AI provider: the role title, approved criteria, resume text and candidate-provided information, with email addresses and
            phone numbers redacted. Profile contact fields, LinkedIn URL and recruiter notes are not sent.
            {ai.provider === "openai" && " Requests are sent with storage disabled (store: false)."}
          </p>
        </div>
      </Card>

      <Card className="p-5">
        <SectionTitle hint="How long inactive candidate data is kept. Activity = profile edits, pipeline changes, notes and assessments.">Data retention</SectionTitle>
        {auth.membershipRole === "admin" ? (
          <RetentionForm days={org.retentionDays} eligible={eligible} cronConfigured={Boolean(process.env.CRON_SECRET)} />
        ) : (
          <p className="text-[13px] text-ink-2">{org.retentionDays ? `${org.retentionDays} days of inactivity` : "Kept until deleted"} · set by a workspace admin.</p>
        )}
      </Card>

      {auth.membershipRole === "admin" && (
        <Card className="p-5">
          <SectionTitle hint="Access, exports, assessments, decisions, stage changes, outreach and deletions — without candidate personal data.">Audit log</SectionTitle>
          <Link href="/settings/audit" className={buttonClass("secondary")}>
            Open audit log
          </Link>
        </Card>
      )}

      {auth.membershipRole === "admin" && (
        <Card className="border-[#f1c9c4] p-5">
          <SectionTitle hint="Permanently deletes every role, candidate, resume file, note and assessment in this workspace, plus member accounts that belong to no other workspace.">
            Delete workspace
          </SectionTitle>
          <DeleteOrg orgName={auth.orgName} />
        </Card>
      )}
    </div>
  );
}
