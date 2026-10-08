import Link from "next/link";
import { Card, PageHeader } from "@/components/ui";
import { requireAuth } from "@/lib/auth";
import { computeMeasures } from "@/lib/measures";

export const metadata = { title: "Measures" };

export default async function MeasuresPage() {
  const auth = await requireAuth();
  const measures = await computeMeasures(auth.orgId);
  const groups = Array.from(new Set(measures.map((m) => m.group)));
  return (
    <div className="max-w-4xl">
      <PageHeader
        eyebrow={<Link href="/settings" className="hover:text-ink">Settings</Link>}
        title="Measures"
        meta={<span>All time, this workspace. Values need at least 5 data points; otherwise they show “Not enough data”.</span>}
      />
      <div className="space-y-5">
        {groups.map((g) => (
          <section key={g}>
            <h2 className="mb-2 text-[15px] font-semibold tracking-tight">{g}</h2>
            <Card className="divide-y divide-line">
              {measures
                .filter((m) => m.group === g)
                .map((m) => (
                  <div key={m.name} className="grid gap-x-6 gap-y-1 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_140px]">
                    <div>
                      <div className="font-medium">{m.name}</div>
                      <div className="text-[12.5px] text-muted">{m.definition}</div>
                      {m.note && <div className="text-[12px] text-faint">{m.note}</div>}
                    </div>
                    <div className="sm:text-right">
                      <div className={m.value ? "text-[17px] font-semibold tabular-nums" : "text-[13px] text-faint"}>{m.value ?? "Not enough data"}</div>
                      <div className="text-[11.5px] text-faint">n = {m.sample}</div>
                    </div>
                  </div>
                ))}
            </Card>
          </section>
        ))}
      </div>
    </div>
  );
}
