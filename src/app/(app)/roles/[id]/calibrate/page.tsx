import clsx from "clsx";
import Link from "next/link";
import { ActionButton } from "@/components/client";
import { AiMark, Badge, Breadcrumbs, Card, EmptyState, Notice, PageHeader, SectionTitle, formatDate } from "@/components/ui";
import { aiStatus } from "@/lib/ai";
import { requireAuth } from "@/lib/auth";
import { db } from "@/lib/db";
import { VERDICT_LABEL, readyToLearn, tally, type Verdict } from "@/lib/loop/calibration";
import { closeCalibration, proposeFromCalibration, suggestFromCalibration } from "@/server/calibration-actions";
import { setMustHave } from "@/server/criteria-actions";
import { ownRole } from "@/server/scope";
import { StartRound, VoteBox } from "./forms";

export const metadata = { title: "Calibration" };
export const maxDuration = 120;

type Sugg = { type: "add" | "make_must_have" | "change_importance" | "clarify" | "remove"; criterion_id: string; name: string; description: string; importance: string; why: string; profiles: string[] };
const TYPE_LABEL: Record<Sugg["type"], string> = { add: "Add criterion", make_must_have: "Make a must-have", change_importance: "Change importance", clarify: "Sharpen wording", remove: "Consider removing" };
const V_TONE: Record<Verdict, string> = { yes: "bg-ok-soft text-ok", no: "bg-danger-soft text-danger", unsure: "bg-sunken text-ink-2" };

/**
 * Calibration: the hiring manager reacts to a handful of real profiles, with reasons. Talyn turns
 * the reasons into suggested criteria changes; the recruiter approves any of them as usual.
 */
export default async function CalibratePage({ params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth();
  const { id } = await params;
  const role = await ownRole(auth, id);
  const [round, past] = await Promise.all([
    db.calibrationRound.findFirst({ where: { orgId: auth.orgId, roleId: id, status: "open" }, orderBy: { createdAt: "desc" }, include: { items: { orderBy: { position: "asc" }, include: { votes: { orderBy: { updatedAt: "asc" } } } } } }),
    db.calibrationRound.findMany({ where: { orgId: auth.orgId, roleId: id, status: "closed" }, orderBy: { createdAt: "desc" }, take: 5, include: { _count: { select: { items: true } } } }),
  ]);
  const ai = aiStatus().configured;

  let options: { value: string; name: string; headline: string; note: string }[] = [];
  if (!round) {
    const [apps, found] = await Promise.all([
      db.application.findMany({
        where: { orgId: auth.orgId, roleId: id, stage: { notIn: ["hired"] } },
        orderBy: { updatedAt: "desc" },
        take: 30,
        select: { id: true, origin: true, candidate: { select: { fullName: true, currentTitle: true, currentCompany: true } }, profileScores: { orderBy: { createdAt: "desc" }, take: 1, select: { score: true } }, _count: { select: { assessments: true } } },
      }),
      db.sourcedProfile.findMany({ where: { orgId: auth.orgId, roleId: id, status: { in: ["new", "saved"] }, savedApplicationId: null }, orderBy: [{ relevanceScore: "desc" }], take: 10, select: { id: true, displayName: true, currentTitle: true, currentCompany: true, relevanceScore: true } }),
    ]);
    options = [
      ...apps
        .filter((a) => a._count.assessments > 0)
        .sort((a, b) => (b.profileScores[0]?.score ?? -1) - (a.profileScores[0]?.score ?? -1))
        .map((a) => ({ value: `application:${a.id}`, name: a.candidate.fullName, headline: [a.candidate.currentTitle, a.candidate.currentCompany].filter(Boolean).join(" · "), note: `${a.origin === "discovered" ? "Found" : "Applied"}${a.profileScores[0]?.score != null ? ` · profile score ${a.profileScores[0].score}` : ""}` })),
      ...found.map((p) => ({ value: `sourced:${p.id}`, name: p.displayName, headline: [p.currentTitle, p.currentCompany].filter(Boolean).join(" · "), note: `In Discover · relevance ${p.relevanceScore}` })),
    ];
    // The same person can be an applicant and a Discover result, or appear in two searches: list them once.
    const seen = new Set<string>();
    options = options.filter((o) => {
      const k = `${o.name.trim().toLowerCase()}|${o.headline.trim().toLowerCase()}`;
      const n = o.name.trim().toLowerCase();
      if (seen.has(k) || (o.value.startsWith("sourced:") && seen.has(`name:${n}`))) return false;
      seen.add(k);
      if (o.value.startsWith("application:")) seen.add(`name:${n}`);
      return true;
    });
  }
  const items = round?.items.map((i) => ({ ...i, votes: i.votes.map((v) => ({ ...v, verdict: v.verdict as Verdict })) })) ?? [];
  const suggestions = round?.suggestionsJson ? (JSON.parse(round.suggestionsJson) as Sugg[]) : [];
  const ready = readyToLearn(items);

  return (
    <>
      <PageHeader
        eyebrow={<Breadcrumbs items={[{ label: "Roles", href: "/roles" }, { label: role.title, href: `/roles/${role.id}` }, { label: "Calibration" }]} />}
        title="Calibrate with the hiring manager"
        meta={<span className="text-[13px] text-muted">React to a few real profiles and say why. Talyn turns the reasons into suggested changes to the criteria; nothing changes until a recruiter approves it.</span>}
      />

      {!round ? (
        <Card className="p-5">
          <SectionTitle hint="Applicants with an assessment and top Discover results for this role.">Pick 3–8 profiles</SectionTitle>
          {options.length < 3 ? (
            <EmptyState title="Not enough profiles yet" body="Assess a few applicants or run a Discover search first, then come back to calibrate." />
          ) : (
            <StartRound roleId={role.id} options={options} />
          )}
        </Card>
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-[13px] text-muted">
              Started {formatDate(round.createdAt)} by {round.createdByName}. Share this page with the hiring manager; anyone in the workspace can vote.
            </p>
            <ActionButton action={closeCalibration.bind(null, round.id)} variant="ghost" confirm="Close this round? Its reasons stay in the company's hiring memory.">
              Close round
            </ActionButton>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            {items.map((it) => {
              const t = tally(it.votes);
              const mine = it.votes.find((v) => v.userId === auth.userId);
              return (
                <Card key={it.id} className="p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-semibold">{it.name}</p>
                      {it.headline && <p className="text-[12.5px] text-muted">{it.headline}</p>}
                    </div>
                    <span className="flex shrink-0 gap-1 text-[11.5px] tabular-nums">
                      {t.yes > 0 && <span className={clsx("rounded px-1.5", V_TONE.yes)}>{t.yes} yes</span>}
                      {t.no > 0 && <span className={clsx("rounded px-1.5", V_TONE.no)}>{t.no} no</span>}
                      {t.unsure > 0 && <span className={clsx("rounded px-1.5", V_TONE.unsure)}>{t.unsure} unsure</span>}
                    </span>
                  </div>
                  <p className="mt-2 text-[13px] text-ink-2">{it.summary}</p>
                  <div className="mt-3">
                    <VoteBox itemId={it.id} mine={mine ? { verdict: mine.verdict, reason: mine.reason } : null} />
                  </div>
                  {it.votes.filter((v) => v.userId !== auth.userId).length > 0 && (
                    <ul className="mt-3 space-y-1 border-t border-line pt-2 text-[12.5px]">
                      {it.votes
                        .filter((v) => v.userId !== auth.userId)
                        .map((v) => (
                          <li key={v.id}>
                            <span className="font-medium">{v.userName}</span>: <span className={clsx("rounded px-1", V_TONE[v.verdict])}>{VERDICT_LABEL[v.verdict]}</span> {v.reason && <span className="text-ink-2">— {v.reason}</span>}
                          </li>
                        ))}
                    </ul>
                  )}
                </Card>
              );
            })}
          </div>

          <Card className="p-5">
            <SectionTitle
              hint="Based on the votes, the reasons, and what this company's hiring managers said before."
              action={
                ai ? (
                  <ActionButton action={suggestFromCalibration.bind(null, round.id)} variant={suggestions.length ? "secondary" : "primary"} disabled={!ready} pendingLabel="Reading the votes…">
                    {suggestions.length ? "Suggest again" : "Suggest criteria changes"}
                  </ActionButton>
                ) : undefined
              }
            >
              What to change in the brief
            </SectionTitle>
            {!ai && <Notice tone="warn">AI is off, so suggestions can&apos;t be written. The votes and reasons are still saved.</Notice>}
            {!ready && <p className="text-[13px] text-muted">Needs at least 3 profiles voted on, with at least one reason.</p>}
            {round.suggestedAt && suggestions.length === 0 && <p className="text-[13px] text-muted">No changes suggested: the votes match the current criteria.</p>}
            {suggestions.length > 0 && (
              <ul className="space-y-2.5">
                {suggestions.map((s, i) => (
                  <li key={i} className="rounded-xl border border-line p-3 text-[13px]">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone="brand">{TYPE_LABEL[s.type]}</Badge>
                      <span className="font-medium">{s.name}</span>
                      {(s.type === "add" || s.type === "change_importance") && <span className="text-[12px] text-muted">{s.importance === "essential" ? "Required" : "Preferred"}</span>}
                    </div>
                    {s.description && <p className="mt-1 text-ink-2">{s.description}</p>}
                    <p className="mt-1 text-muted">{s.why}</p>
                    {s.profiles.length > 0 && <p className="mt-0.5 text-[12px] text-faint">From: {s.profiles.join(", ")}</p>}
                    <div className="mt-2">
                      {s.type === "add" ? (
                        <ActionButton action={proposeFromCalibration.bind(null, round.id, i)}>Add as a suggestion</ActionButton>
                      ) : s.type === "make_must_have" ? (
                        <ActionButton action={setMustHave.bind(null, s.criterion_id, true)}>Make it a must-have</ActionButton>
                      ) : (
                        <Link href={`/roles/${role.id}?tab=criteria`} className="text-[12.5px] font-medium text-brand hover:underline">
                          Edit on the Criteria tab →
                        </Link>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
            {round.suggestedAt && (
              <p className="mt-3 flex items-center gap-1.5 text-[11.5px] text-faint">
                <AiMark /> Suggestions only. Criteria change only when a recruiter approves them.
              </p>
            )}
          </Card>
        </div>
      )}

      {past.length > 0 && (
        <section className="mt-6">
          <h2 className="mb-2 text-[13px] font-semibold">Earlier rounds</h2>
          <ul className="space-y-1 text-[13px] text-muted">
            {past.map((p) => (
              <li key={p.id}>
                {formatDate(p.createdAt)} · {p._count.items} profiles · started by {p.createdByName}
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
