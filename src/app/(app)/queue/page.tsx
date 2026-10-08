import Link from "next/link";
import { Card, EmptyState, PageHeader } from "@/components/ui";
import { requireAuth } from "@/lib/auth";
import { buildQueue } from "@/lib/queue";

export const metadata = { title: "Queue" };

function waiting(since: Date) {
  const mins = Math.max(0, Math.floor((Date.now() - since.getTime()) / 60000));
  if (mins < 60) return `${Math.max(1, mins)}m`;
  const h = Math.floor(mins / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

export default async function QueuePage() {
  const auth = await requireAuth();
  const sections = await buildQueue(auth.orgId);
  const total = sections.reduce((n, s) => n + s.items.length, 0);
  return (
    <>
      <PageHeader title="Queue" meta={<span>{total ? `${total} item${total > 1 ? "s" : ""} waiting for you` : "Nothing waiting"}</span>} />
      {total === 0 ? (
        <EmptyState title="You're all caught up" body="New CV reviews, assessments to check, decisions and information requests will appear here." />
      ) : (
        <div className="space-y-6">
          {sections.map((s) => (
            <section key={s.key} aria-labelledby={`q-${s.key}`}>
              <div className="mb-2 flex items-baseline justify-between gap-3">
                <h2 id={`q-${s.key}`} className="text-[15px] font-semibold tracking-tight">
                  {s.title} <span className="text-[13px] font-normal tabular-nums text-faint">{s.items.length}</span>
                </h2>
                <span className="hidden text-[12.5px] text-muted sm:block">{s.hint}</span>
              </div>
              {s.setup ? (
                <p className="rounded-xl border border-dashed border-line-strong px-4 py-3 text-[13px] text-muted">{s.setup}</p>
              ) : s.items.length === 0 ? (
                <p className="px-1 text-[13px] text-faint">Nothing here.</p>
              ) : (
                <Card className="divide-y divide-line overflow-hidden">
                  {s.items.map((it) => (
                    <Link key={it.key} href={it.href} className="flex items-center gap-4 px-4 py-2.5 hover:bg-[#fbfaf8]">
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-medium">{it.candidateName}</div>
                        <div className="truncate text-[12.5px] text-muted">{[it.roleTitle, it.detail].filter(Boolean).join(" · ") || " "}</div>
                      </div>
                      <span className="shrink-0 text-[12px] tabular-nums text-faint" title={`Waiting since ${it.since.toLocaleString()}`}>
                        waiting {waiting(it.since)}
                      </span>
                    </Link>
                  ))}
                </Card>
              )}
            </section>
          ))}
        </div>
      )}
    </>
  );
}
