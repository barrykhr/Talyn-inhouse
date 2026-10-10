import { notFound } from "next/navigation";
import { Badge, Breadcrumbs, Card, PageHeader, SectionTitle, formatDate } from "@/components/ui";
import { aiStatus } from "@/lib/ai";
import { requireAuth } from "@/lib/auth";
import { db } from "@/lib/db";
import { transcriptAccess } from "@/lib/interviews/transcript-access";
import { CONSENT_LABEL, fmtTs } from "@/lib/transcripts/parse";
import { AnalyzeButton, DeleteRecordingButton, InsightCard, SegmentRow, SpeakerRow, type InsightView } from "./viewer";

export const metadata = { title: "Transcript" };
export const maxDuration = 300;

export default async function RecordingPage({ params }: { params: Promise<{ kitId: string; recordingId: string }> }) {
  const auth = await requireAuth();
  const { kitId, recordingId } = await params;
  const acc = await transcriptAccess(auth, kitId);
  const rec = await db.interviewRecording.findFirst({
    where: { id: recordingId, kitId, orgId: auth.orgId },
    include: { segments: { orderBy: { idx: "asc" } }, insights: { orderBy: { createdAt: "asc" } }, stage: { select: { name: true } } },
  });
  if (!acc || !rec || !acc.canSeeStage(rec.stageId)) notFound();
  const segAt = new Map(rec.segments.map((s) => [s.id, fmtTs(s.startMs)]));
  const view = (i: (typeof rec.insights)[number]): InsightView => ({
    id: i.id,
    kind: i.kind,
    competencyName: i.competencyName,
    coverage: i.coverage,
    text: i.text,
    editedText: i.editedText,
    quote: i.quote,
    refs: (JSON.parse(i.segmentIdsJson) as string[]).filter((id) => segAt.has(id)).map((id) => ({ id, at: segAt.get(id)! })),
    status: i.status,
    reviewedBy: i.reviewedByName,
    reviewedAt: i.reviewedAt?.toISOString() ?? null,
    usedBy: i.usedInScorecardBy,
  });
  const speakers = [...new Map(rec.segments.map((s) => [s.speaker, s.speakerRole])).entries()].map(([label, role]) => {
    const segs = rec.segments.filter((s) => s.speaker === label);
    const set = segs.filter((s) => s.speakerSetAt).sort((a, b) => +b.speakerSetAt! - +a.speakerSetAt!)[0];
    return { label, role, count: segs.length, setBy: set ? `${set.speakerSetBy}, ${formatDate(set.speakerSetAt!)}` : null };
  });
  const mine = acc.mine.find((a) => a.stageId === rec.stageId);
  const by = (k: string) => rec.insights.filter((i) => i.kind === k);
  const ai = aiStatus().configured;
  const kit = acc.kit;

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow={
          <Breadcrumbs
            items={[
              { label: "Interviews", href: "/interviews" },
              { label: `${kit.application.candidate.fullName} · ${kit.application.role.title}`, href: `/interviews/${kitId}` },
              { label: "Recordings & transcripts", href: `/interviews/${kitId}/transcripts` },
              { label: rec.stage.name },
            ]}
          />
        }
        title={`${rec.stage.name} — transcript`}
        meta={
          <>
            <Badge tone={rec.status === "transcribed" ? "ok" : "danger"}>{rec.status === "transcribed" ? "Transcribed" : "Failed"}</Badge>
            <span>{rec.source === "audio_upload" ? `Transcribed by ${rec.provider} (audio not kept)` : `Imported from ${rec.fileName} (${rec.provider.replace("import:", "")})`}</span>
            <span>
              Consent: {CONSENT_LABEL[rec.consentMethod]} — confirmed by {rec.consentByName}, {formatDate(rec.consentAt)}
              {rec.consentNote ? ` (“${rec.consentNote}”)` : ""}
            </span>
          </>
        }
        actions={acc.canManage(rec.consentById) ? <DeleteRecordingButton recordingId={rec.id} /> : undefined}
      />
      <Card className="p-3 text-[12px] text-ink-2">
        <strong>What you&apos;re looking at:</strong> <span className="font-medium">Transcript text</span> comes from the meeting tool or transcription provider and may contain errors or wrong
        speakers — correct it. <span className="font-medium text-brand">AI suggestions</span> (dashed) are drafts for review, each linked to its passages.{" "}
        <span className="font-medium">Extracted evidence</span> is a quote from a passage. <span className="font-medium">Interviewer notes and ratings</span> live only in each interviewer&apos;s
        scorecard and are never generated. Nothing here rates, rejects, advances or submits anything. Transcripts aren&apos;t used to train models.
      </Card>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
        <section aria-labelledby="tr-h" className="min-w-0">
          <SectionTitle hint="Timestamps come from the source file. Hover a passage to correct it; the original is kept.">
            <span id="tr-h">Transcript · {rec.segments.length} passages</span>
          </SectionTitle>
          <Card className="mb-3 space-y-1.5 p-3">
            <div className="text-[12px] font-semibold text-muted">Who is speaking? Speaker labels can be wrong — set them before relying on evidence.</div>
            {speakers.map((s) => (
              <SpeakerRow key={s.label} recordingId={rec.id} label={s.label} role={s.role} count={s.count} setBy={s.setBy} />
            ))}
          </Card>
          <Card className="max-h-[75vh] overflow-y-auto p-2">
            <ol className="space-y-0.5">
              {rec.segments.map((s) => (
                <SegmentRow
                  key={s.id}
                  s={{ id: s.id, idx: s.idx, at: fmtTs(s.startMs), speaker: s.speaker, role: s.speakerRole, text: s.text, original: s.originalText, editedBy: s.editedByName, editedAt: s.editedAt?.toISOString() ?? null }}
                />
              ))}
            </ol>
          </Card>
        </section>

        <section aria-labelledby="ci-h" className="min-w-0 space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <h2 id="ci-h" className="text-[15px] font-semibold">
                Conversation intelligence
              </h2>
              <p className="text-[12px] text-muted">
                {rec.analyzedAt ? `Analysed ${formatDate(rec.analyzedAt)} by ${rec.analysisModel}. ` : ""}Decision support only — verify each item against its passage.
              </p>
            </div>
            {rec.status === "transcribed" && <AnalyzeButton recordingId={rec.id} again={!!rec.analyzedAt} aiOn={ai} />}
          </div>
          {!ai && <p className="text-[13px] text-muted">AI is off, so no new suggestions can be made. The transcript can still be read, corrected and used by interviewers.</p>}
          {rec.insights.length === 0 && ai && <p className="text-[13px] text-muted">No suggestions yet. Correct speakers first, then analyse.</p>}

          {by("summary").length > 0 && (
            <div className="space-y-1.5">
              <div className="text-[11.5px] font-semibold uppercase tracking-wide text-muted">Draft summary</div>
              {by("summary").map((i) => (
                <InsightCard key={i.id} i={view(i)} canUseInScorecard={false} />
              ))}
            </div>
          )}
          {by("coverage").length > 0 && (
            <div className="space-y-1.5">
              <div className="text-[11.5px] font-semibold uppercase tracking-wide text-muted">Criteria coverage</div>
              <p className="text-[12px] text-faint">“Not discussed” means it didn&apos;t come up — not that the candidate lacks it.</p>
              {by("coverage").map((i) => (
                <InsightCard key={i.id} i={view(i)} canUseInScorecard={false} />
              ))}
            </div>
          )}
          {by("evidence").length > 0 && (
            <div className="space-y-1.5">
              <div className="text-[11.5px] font-semibold uppercase tracking-wide text-muted">Evidence suggestions for scorecards</div>
              <p className="text-[12px] text-faint">
                {mine && mine.status !== "submitted"
                  ? "Accept or edit after checking the passage, then add it to your own draft scorecard. You still rate and submit."
                  : "Interviewers on this stage can add reviewed evidence to their own draft scorecard."}
              </p>
              {by("evidence").map((i) => (
                <InsightCard key={i.id} i={view(i)} canUseInScorecard={!!mine && mine.status !== "submitted"} />
              ))}
            </div>
          )}
          {by("follow_up").length > 0 && (
            <div className="space-y-1.5">
              <div className="text-[11.5px] font-semibold uppercase tracking-wide text-muted">Follow-up questions</div>
              {by("follow_up").map((i) => (
                <InsightCard key={i.id} i={view(i)} canUseInScorecard={false} />
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
