import { ActionButton } from "@/components/client";
import { AiMark, Card, SectionTitle, formatDate } from "@/components/ui";
import { CHECK_LABEL, type InsightCheck } from "@/lib/role-insights";
import { generateRoleInsights } from "@/server/role-insight-actions";

export type RoleInsightView = {
  checks: InsightCheck[];
  growth: { from_titles: string[]; next_titles: string[]; note: string } | null;
  model: string;
  jdFileName: string | null;
  generatedByName: string;
  generatedAt: Date;
} | null;

const KIND_CLS: Record<string, string> = {
  exclusionary: "bg-danger-soft text-danger",
  conflicting: "bg-warn-soft text-warn",
  vague: "bg-sunken text-ink-2",
  missing: "bg-sunken text-ink-2",
};

/** JD quality check and growth path for a role. Suggestions only: the recruiter edits the JD. */
export function RoleInsights({ roleId, insight, hasJd }: { roleId: string; insight: RoleInsightView; hasJd: boolean }) {
  const ai = !!insight && insight.model !== "rules";
  return (
    <Card className="p-5">
      <SectionTitle
        hint="Checks the JD for vague, conflicting, exclusionary or missing points before you search, and shows the usual career path. Suggestions only: nothing about the role changes."
        action={
          <ActionButton action={generateRoleInsights.bind(null, roleId)} pendingLabel="Checking…" disabled={!hasJd}>
            {insight ? "Check again" : "Check the JD"}
          </ActionButton>
        }
      >
        Role insights
      </SectionTitle>
      {!insight ? (
        <p className="text-[13px] text-muted">{hasJd ? "Not checked yet." : "Upload a JD or add a role description first."}</p>
      ) : (
        <div className="space-y-4">
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-faint">
            {ai ? (
              <>
                <AiMark /> AI review plus a rule-based check for exclusionary wording · {insight.model}
              </>
            ) : (
              "Rule-based check for exclusionary wording only (no AI)"
            )}
            <span>
              · {insight.jdFileName ? `${insight.jdFileName} · ` : ""}
              {insight.generatedByName}, {formatDate(insight.generatedAt)}
            </span>
          </p>
          <div>
            <h4 className="mb-1.5 text-[12px] font-semibold uppercase tracking-wide text-muted">JD quality check</h4>
            {insight.checks.length === 0 ? (
              <p className="text-[13px] text-muted">Nothing to flag{ai ? "" : " by the rule-based check"}.</p>
            ) : (
              <ul className="divide-y divide-line rounded-lg border border-line">
                {insight.checks.map((c, i) => (
                  <li key={i} className="space-y-1 px-3 py-2.5 text-[13px]">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`rounded px-1.5 py-px text-[11.5px] font-semibold ${KIND_CLS[c.kind] ?? ""}`}>{CHECK_LABEL[c.kind]}</span>
                      <span>{c.issue}</span>
                      {c.by === "rule" && <span className="text-[11.5px] text-faint">rule-based</span>}
                    </div>
                    {c.quote && (
                      <p className="text-[12.5px] text-ink-2">
                        <span className="quote">“{c.quote}”</span>
                        {!c.verified && <span className="ml-1 text-[11.5px] text-warn">not found word for word in the JD — check it</span>}
                      </p>
                    )}
                    {c.suggestion && <p className="text-[12.5px] text-muted">Suggestion: {c.suggestion}</p>}
                  </li>
                ))}
              </ul>
            )}
          </div>
          {insight.growth && (
            <div>
              <h4 className="mb-1.5 text-[12px] font-semibold uppercase tracking-wide text-muted">Growth path</h4>
              <p className="flex flex-wrap items-center gap-1.5 text-[13px]">
                {insight.growth.from_titles.map((t) => (
                  <span key={t} className="rounded-md border border-line px-2 py-0.5">{t}</span>
                ))}
                <span aria-hidden className="text-faint">→</span>
                <span className="rounded-md border border-ink bg-ink px-2 py-0.5 text-white">This role</span>
                <span aria-hidden className="text-faint">→</span>
                {insight.growth.next_titles.map((t) => (
                  <span key={t} className="rounded-md border border-line px-2 py-0.5">{t}</span>
                ))}
              </p>
              <p className="mt-1 text-[12.5px] text-muted">{insight.growth.note}</p>
              <p className="mt-1 text-[11.5px] text-faint">Useful as alternative titles to search. AI-generated from market knowledge; check before relying on it.</p>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
