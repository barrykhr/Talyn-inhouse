import { Badge, Card, PageHeader, SectionTitle } from "@/components/ui";
import { aiStatus } from "@/lib/ai";
import { requireAuth } from "@/lib/auth";
import { db } from "@/lib/db";
import { DeleteOrg } from "./delete-org";

export const metadata = { title: "Settings" };

export default async function SettingsPage() {
  const auth = await requireAuth();
  const ai = aiStatus();
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
        <div className="mb-3 flex items-center gap-2 text-[13px]">
          {ai.configured ? <Badge tone="ok">Configured</Badge> : <Badge>Not configured</Badge>}
          {ai.configured && <span className="font-mono text-[12px] text-muted">{ai.model}</span>}
        </div>
        <div className="space-y-2 text-[13px] text-ink-2">
          <p>
            AI proposes role criteria from job descriptions and assesses candidates against approved criteria, citing evidence. It never moves, hides or rejects
            candidates; every stage change and decision is made by a recruiter.
          </p>
          {!ai.configured && (
            <p>
              To enable it, set <code className="font-mono">ANTHROPIC_API_KEY</code> in <code className="font-mono">.env</code> and restart the server. Optionally set{" "}
              <code className="font-mono">TALYN_AI_MODEL</code>. Without a key, you can still add criteria manually, extract them from JD bullet points, and run
              keyword checks — these are always labeled as non-AI.
            </p>
          )}
          <p className="text-muted">
            What is sent to the AI provider: the role title, approved criteria, resume text and candidate-provided information, with email addresses and
            phone numbers redacted. Profile contact fields, LinkedIn URL and recruiter notes are not sent.
          </p>
        </div>
      </Card>

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
