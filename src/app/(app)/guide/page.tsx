import Link from "next/link";
import { Badge, Card, PageHeader } from "@/components/ui";
import guide from "@/content/guide.json";
import { aiStatus } from "@/lib/ai";
import { requireAuth } from "@/lib/auth";
import { db } from "@/lib/db";
import { calendarConfigured } from "@/lib/calendar/google";
import { getEmailProvider } from "@/lib/outreach/provider";
import { whatsappConfigured } from "@/lib/outreach/whatsapp";
import { CONNECTORS } from "@/lib/sourcing/connectors";

export const metadata = { title: "Guide" };

type Need = "ai_optional" | "sourcing" | "email" | "whatsapp" | "calendar" | "recording";

/** In-product guide: where each feature lives and how to use it, with live setup status. */
export default async function GuidePage() {
  const auth = await requireAuth();
  const org = await db.organization.findUniqueOrThrow({ where: { id: auth.orgId }, select: { recordingEnabled: true } });
  const ai = aiStatus().configured;
  const on: Record<Exclude<Need, "ai_optional">, boolean> = {
    sourcing: CONNECTORS.some((c) => c.kind === "external" && c.configured()),
    email: !!getEmailProvider(),
    whatsapp: whatsappConfigured(),
    calendar: calendarConfigured(),
    recording: org.recordingEnabled,
  };
  const LABEL: Record<string, string> = { sourcing: "Sourcing provider", email: "Email sending", whatsapp: "WhatsApp", calendar: "Google Calendar", recording: "Recording policy" };
  const badges = (needs: string[]) => {
    const out: { tone: "ok" | "warn" | "neutral"; text: string; title: string }[] = [];
    const hard = needs.filter((n) => n !== "ai_optional") as (keyof typeof on)[];
    if (!hard.length) out.push({ tone: "ok", text: "Ready", title: "Works now; no integration needed." });
    for (const n of hard)
      out.push(
        on[n]
          ? { tone: "ok", text: `${LABEL[n]}: connected`, title: "Configured in this deployment." }
          : { tone: "warn", text: `${LABEL[n]}: needs setup`, title: "Not configured — the feature shows a setup or demo state. See Integrations." },
      );
    if (needs.includes("ai_optional"))
      out.push(ai ? { tone: "ok", text: "AI on", title: "Uses AI where it helps." } : { tone: "neutral", text: "AI off — non-AI fallback", title: "Works without AI using labelled non-AI methods." });
    return out;
  };

  return (
    <div className="max-w-4xl">
      <PageHeader title="Guide" meta={<span>{guide.intro}</span>} />
      <nav aria-label="Guide sections" className="mb-6 flex flex-wrap gap-1.5 text-[13px]">
        {guide.sections.map((s) => (
          <a key={s.id} href={`#${s.id}`} className="rounded-lg border border-line bg-surface px-2.5 py-1 font-medium text-ink-2 hover:bg-sunken hover:text-ink">
            {s.title}
          </a>
        ))}
      </nav>
      <div className="space-y-8">
        {guide.sections.map((s) => (
          <section key={s.id} id={s.id} className="scroll-mt-6" aria-labelledby={`${s.id}-h`}>
            <h2 id={`${s.id}-h`} className="mb-2 text-[16px] font-semibold tracking-tight">
              {s.title}
            </h2>
            <div className="space-y-3">
              {s.features.map((f) => (
                <Card key={f.name} className="p-4">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <h3 className="text-[14.5px] font-semibold">{f.name}</h3>
                      <p className="text-[12.5px] text-muted">
                        Where:{" "}
                        <Link href={f.href} className="font-medium text-brand hover:underline">
                          {f.where}
                        </Link>
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {badges(f.needs).map((b) => (
                        <Badge key={b.text} tone={b.tone} title={b.title}>
                          {b.text}
                        </Badge>
                      ))}
                    </div>
                  </div>
                  <ol className="mt-2.5 list-decimal space-y-1 pl-5 text-[13.5px] text-ink-2">
                    {f.steps.map((st) => (
                      <li key={st}>{st}</li>
                    ))}
                  </ol>
                  {f.notes && <p className="mt-2 border-t border-line pt-2 text-[12.5px] text-muted">{f.notes}</p>}
                </Card>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
