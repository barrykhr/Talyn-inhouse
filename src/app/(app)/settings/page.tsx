import Link from "next/link";
import { Badge, Card, PageHeader, SectionTitle, buttonClass } from "@/components/ui";
import { eligibleForRetention } from "@/lib/retention";
import { RetentionForm } from "./retention";
import { PROVIDER_LABEL, aiStatus } from "@/lib/ai";
import { ATS_SETUP_HINT, getAtsConnector } from "@/lib/ats/connector";
import { SENDING_SETUP_HINT, getEmailProvider } from "@/lib/outreach/provider";
import { WHATSAPP_SETUP_HINT, whatsappConfigured } from "@/lib/outreach/whatsapp";
import { CONNECTORS } from "@/lib/sourcing/connectors";
import { requireAuth } from "@/lib/auth";
import { db } from "@/lib/db";
import { DeleteOrg } from "./delete-org";
import { TeamCard } from "./team";

export const metadata = { title: "Settings" };

export default async function SettingsPage() {
  const auth = await requireAuth();
  const ai = aiStatus();
  const org = await db.organization.findUniqueOrThrow({ where: { id: auth.orgId }, select: { retentionDays: true } });
  const eligible = org.retentionDays ? (await eligibleForRetention(auth.orgId, org.retentionDays)).length : null;
  const invites = await db.invite.findMany({ where: { orgId: auth.orgId, acceptedAt: null, revokedAt: null, expiresAt: { gt: new Date() } }, orderBy: { createdAt: "desc" } });
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
        </dl>
      </Card>

      <Card className="p-5">
        <SectionTitle hint="Invite recruiters and hiring managers so they can interview and submit scorecards.">Team</SectionTitle>
        <TeamCard
          isAdmin={auth.membershipRole === "admin"}
          members={members.map((m) => ({ id: m.id, name: m.user.name, email: m.user.email, role: m.role, you: m.userId === auth.userId }))}
          invites={invites.map((i) => ({ id: i.id, name: i.name, email: i.email, role: i.role, expiresAt: i.expiresAt.toISOString(), invitedByName: i.invitedByName }))}
        />
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
        <SectionTitle hint="What Talyn is connected to. Nothing here sends data anywhere unless it says Connected.">Integrations &amp; data providers</SectionTitle>
        <dl className="space-y-2.5 text-[13px]">
          <div>
            <dt className="font-medium">AI provider</dt>
            <dd className="text-muted">{ai.configured && ai.provider ? `${PROVIDER_LABEL[ai.provider]} · ${ai.model} — receives role/criteria text, CV text with email and phone redacted, and confirmed profile facts for drafting outreach.` : "Not configured — AI features are off; labeled non-AI helpers are used."}</dd>
          </div>
          {CONNECTORS.map((c) => (
            <div key={c.key}>
              <dt className="font-medium">
                Sourcing · {c.label} <span className={c.configured() ? "text-ok" : "text-faint"}>{c.configured() ? "● Connected" : "○ Not connected"}</span>
              </dt>
              <dd className="text-muted">{c.configured() ? c.description : c.setupHint}</dd>
            </div>
          ))}
          <div>
            <dt className="font-medium">
              Email sending <span className={getEmailProvider() ? "text-ok" : "text-faint"}>{getEmailProvider() ? "● Connected" : "○ Not connected"}</span>
            </dt>
            <dd className="text-muted">{getEmailProvider() ? "SMTP — sends only approved messages in sequences a recruiter activated." : SENDING_SETUP_HINT}</dd>
          </div>
          <div>
            <dt className="font-medium">
              WhatsApp <span className={whatsappConfigured() ? "text-ok" : "text-faint"}>{whatsappConfigured() ? "● Connected" : "○ Not connected"}</span>
            </dt>
            <dd className="text-muted">{whatsappConfigured() ? "Sends approved templates to candidates with a recorded WhatsApp opt-in." : WHATSAPP_SETUP_HINT}</dd>
          </div>
          <div>
            <dt className="font-medium">
              ATS <span className={getAtsConnector() ? "text-ok" : "text-faint"}>{getAtsConnector() ? "● Connected" : "○ Not connected"}</span>
            </dt>
            <dd className="text-muted">{getAtsConnector() ? `${getAtsConnector()!.label} — configured. Link and sync in Integrations.` : ATS_SETUP_HINT}</dd>
          </div>
        </dl>
        <div className="mt-4 flex flex-wrap gap-2">
          <Link href="/settings/integrations" className={buttonClass("primary")}>
            Manage integrations
          </Link>
          <Link href="/settings/measures" className={buttonClass("secondary")}>
            View success measures
          </Link>
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
