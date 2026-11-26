import { notFound, redirect } from "next/navigation";
import { ActionButton } from "@/components/client";
import { Breadcrumbs, Card, PageHeader, SectionTitle, formatDate } from "@/components/ui";
import { requireAuth } from "@/lib/auth";
import { fmtMs } from "@/lib/calls/core";
import { db } from "@/lib/db";
import { deleteCall } from "@/server/call-actions";
import { callSetupOptions } from "@/server/call-view";
import { CallDetailsForm } from "../../roles/[id]/calls/forms";

export const metadata = { title: "Set up call" };

/** A call that arrived from a notetaker: a person says which role it belongs to and who was on it. */
export default async function CallSetupPage({ params }: { params: Promise<{ callId: string }> }) {
  const auth = await requireAuth();
  const { callId } = await params;
  const call = await db.roleCall.findFirst({ where: { id: callId, orgId: auth.orgId }, include: { segments: { orderBy: { idx: "asc" }, take: 12 } } });
  if (!call) notFound();
  if (call.roleId && call.status !== "needs_role") redirect(`/roles/${call.roleId}/calls/${call.id}`);
  const { roles, byRole } = await callSetupOptions(auth.orgId);
  const participants = JSON.parse(call.participantsJson) as { name: string; email?: string }[];
  return (
    <>
      <PageHeader
        eyebrow={<Breadcrumbs items={[{ label: "Inbox", href: "/inbox" }, { label: "Set up call" }]} />}
        title={call.title}
        meta={
          <span className="text-[13px] text-muted">
            From {call.provider.split(":")[1] ?? "notetaker"} · {formatDate(call.occurredAt ?? call.createdAt)}
            {call.durationMs ? ` · ${fmtMs(call.durationMs)}` : ""}
          </span>
        }
        actions={<ActionButton action={deleteCall.bind(null, call.id)} variant="ghost" confirm="Delete this call and its transcript?">Delete</ActionButton>}
      />
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
        <Card className="p-5">
          <SectionTitle hint="Nothing is checked until you confirm this.">Which role is this call for, and who was on it?</SectionTitle>
          <CallDetailsForm
            callId={call.id}
            roles={roles}
            current={{ roleId: call.roleId, kind: call.kind, interviewerName: call.interviewerName, interviewerRole: call.interviewerRole, applicationId: call.applicationId, title: call.title }}
            applicationsByRole={byRole}
          />
        </Card>
        <aside className="space-y-4">
          {participants.length > 0 && (
            <Card className="p-4 text-[13px]">
              <p className="mb-1 font-semibold">Participants</p>
              <ul className="space-y-0.5 text-ink-2">
                {participants.map((p, i) => (
                  <li key={i}>
                    {p.name}
                    {p.email ? <span className="text-muted"> · {p.email}</span> : null}
                  </li>
                ))}
              </ul>
            </Card>
          )}
          <Card className="p-4 text-[13px]">
            <p className="mb-1 font-semibold">Start of the transcript</p>
            <ol className="space-y-1 text-ink-2">
              {call.segments.map((s) => (
                <li key={s.id}>
                  <span className="font-mono text-[11.5px] text-faint">{fmtMs(s.startMs)}</span> <span className="font-medium">{s.speaker}:</span> {s.text}
                </li>
              ))}
            </ol>
          </Card>
        </aside>
      </div>
    </>
  );
}
