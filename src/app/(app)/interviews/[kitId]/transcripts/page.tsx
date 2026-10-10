import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, Card, EmptyState, SectionTitle, formatDate } from "@/components/ui";
import { KitHeader } from "../../kit-header";
import { aiStatus } from "@/lib/ai";
import { requireAuth } from "@/lib/auth";
import { db } from "@/lib/db";
import { transcriptAccess } from "@/lib/interviews/transcript-access";
import { CONSENT_LABEL, fmtTs } from "@/lib/transcripts/parse";
import { transcriptionConfigured, transcriptionSetup } from "@/lib/transcripts/provider";
import { AddTranscriptForm } from "./add-form";

export const metadata = { title: "Recordings & transcripts" };
// Uploaded recordings are transcribed in the request.
export const maxDuration = 300;

const STATUS: Record<string, { label: string; tone: "ok" | "warn" | "danger" | "neutral" }> = {
  transcribed: { label: "Transcribed", tone: "ok" },
  transcribing: { label: "Transcribing", tone: "warn" },
  failed: { label: "Failed — no transcript", tone: "danger" },
};

export default async function TranscriptsPage({ params }: { params: Promise<{ kitId: string }> }) {
  const auth = await requireAuth();
  const { kitId } = await params;
  const acc = await transcriptAccess(auth, kitId);
  if (!acc) notFound();
  const { kit } = acc;
  const [org, recordings] = await Promise.all([
    db.organization.findUniqueOrThrow({ where: { id: auth.orgId }, select: { recordingEnabled: true, recordingPolicy: true } }),
    db.interviewRecording.findMany({ where: { kitId, orgId: auth.orgId }, orderBy: { createdAt: "desc" }, include: { _count: { select: { segments: true, insights: true } } } }),
  ]);
  const audioReady = transcriptionConfigured();
  const setup = transcriptionSetup();
  const header = (
    <>
      <KitHeader
        kitId={kit.id}
        candidate={kit.application.candidate}
        role={kit.application.role}
        status={kit.status}
        active="transcripts"
        myScorecards={kit.status === "shared" ? acc.mine.map((a) => ({ id: a.id, stage: kit.stages.find((s) => s.id === a.stageId)?.name ?? "Stage", status: a.status })) : []}
        decision={kit.decision}
      />
      <p className="-mt-2 mb-4 text-[13px] text-muted">
        Talyn never records meetings or listens in. The team brings a transcript (or a recording, when a provider is set up) after following your consent process.
      </p>
    </>
  );
  if (!acc.anyAccess) return (<>{header}<EmptyState title="Interview team only" body="Transcripts are visible to admins, recruiters, the plan owner, its hiring manager and the assigned interviewers." /></>);

  return (
    <div className="max-w-4xl space-y-5">
      {header}
      {!org.recordingEnabled ? (
        <Card className="p-4 text-[13.5px]">
          <div className="font-semibold">Not set up</div>
          <p className="mt-1 text-ink-2">
            Interview recording &amp; transcription is off for this workspace. An admin turns it on in Workspace settings by describing the organisation&apos;s recording and consent process.
            Until then nothing can be added here.
          </p>
          <Link href="/settings#recording" className="mt-2 inline-block text-[13px] font-medium text-brand hover:underline">
            Go to settings
          </Link>
        </Card>
      ) : (
        <Card className="p-4 text-[12.5px] text-ink-2">
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            <span>
              Transcript import: <Badge tone="ok">Available</Badge>
            </span>
            <span>
              Recording upload: {audioReady ? <Badge tone="ok">Transcription provider connected</Badge> : <Badge tone="warn">No provider — set {setup.checks.filter((c) => !c.optional && (c.name === "TRANSCRIPTION_ENABLED" ? process.env.TRANSCRIPTION_ENABLED !== "true" : c.name === "TRANSCRIPTION_PROVIDER" ? process.env.TRANSCRIPTION_PROVIDER !== "openai" : !c.set)).map((c) => (c.name === "TRANSCRIPTION_ENABLED" ? "TRANSCRIPTION_ENABLED=true" : c.name === "TRANSCRIPTION_PROVIDER" ? "TRANSCRIPTION_PROVIDER=openai" : c.name)).join(", ")}</Badge>}
            </span>
            <span>
              Summary &amp; evidence suggestions: {aiStatus().configured ? <Badge tone="ok">AI on</Badge> : <Badge>AI off — transcript only</Badge>}
            </span>
          </div>
        </Card>
      )}

      {kit.stages.map((st) => {
        const visible = acc.canSeeStage(st.id);
        const recs = recordings.filter((r) => r.stageId === st.id);
        return (
          <section key={st.id} aria-labelledby={`st-${st.id}`}>
            <SectionTitle hint={visible ? undefined : "Visible after you submit your own scorecards, so feedback stays independent."}>
              <span id={`st-${st.id}`}>{st.name}</span>
            </SectionTitle>
            {!visible ? null : (
              <div className="space-y-2">
                {recs.length === 0 && <p className="text-[13px] text-muted">No transcript for this stage.</p>}
                {recs.map((r) => (
                  <Card key={r.id} className="flex flex-wrap items-center justify-between gap-2 p-3 text-[13px]">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <Link href={`/interviews/${kitId}/transcripts/${r.id}`} className="font-medium hover:underline">
                          {r.fileName}
                        </Link>
                        <Badge tone={STATUS[r.status]?.tone ?? "neutral"}>{STATUS[r.status]?.label ?? r.status}</Badge>
                        <Badge>{r.source === "audio_upload" ? `Transcribed by ${r.provider}` : `Imported (${r.provider.replace("import:", "")})`}</Badge>
                      </div>
                      <div className="text-[12px] text-muted">
                        {r._count.segments} passages{r.durationMs ? ` · ${fmtTs(r.durationMs)}` : ""} · added {formatDate(r.createdAt)} by {r.createdByName} · consent: {CONSENT_LABEL[r.consentMethod] ?? r.consentMethod}, confirmed by {r.consentByName}
                        {r.analyzedAt ? ` · analysed ${formatDate(r.analyzedAt)}` : ""}
                      </div>
                      {r.error && <div className="text-[12px] text-danger">{r.error}</div>}
                    </div>
                    <Link href={`/interviews/${kitId}/transcripts/${r.id}`} className="text-[13px] font-medium text-brand hover:underline">
                      Open
                    </Link>
                  </Card>
                ))}
                {org.recordingEnabled && <AddTranscriptForm stageId={st.id} policy={org.recordingPolicy} audioReady={audioReady} />}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
