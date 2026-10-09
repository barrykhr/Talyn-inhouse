import clsx from "clsx";
import Link from "next/link";
import { AUDIT_LABEL } from "@/lib/audit";
import { Card, EmptyState, LinkButton, PageHeader, formatDateTime } from "@/components/ui";
import { attention } from "@/lib/attention";
import { requireAuth } from "@/lib/auth";
import { db } from "@/lib/db";
import { isLiveSourceConnected } from "@/lib/sourcing/connectors";

export const metadata = { title: "Home" };

type StepState = "done" | "todo" | "optional" | "blocked";
const STATE_LABEL: Record<StepState, string> = { done: "Done", todo: "To do", optional: "Optional", blocked: "Blocked" };

/** Home: what needs a person now, then setup for new workspaces. Real counts only. */
export default async function HomePage() {
  const auth = await requireAuth();
  const [groups, roles, approved, members, assignments, decided, inPipelines, openRoles, recent] = await Promise.all([
    attention(auth.orgId),
    db.role.count({ where: { orgId: auth.orgId } }),
    db.criterion.count({ where: { orgId: auth.orgId, status: "approved" } }),
    db.membership.count({ where: { orgId: auth.orgId } }),
    db.interviewAssignment.count({ where: { stage: { kit: { orgId: auth.orgId } } } }),
    db.application.count({ where: { orgId: auth.orgId, decision: { not: null } } }),
    db.application.count({ where: { orgId: auth.orgId, stage: { notIn: ["hired", "rejected"] } } }),
    db.role.count({ where: { orgId: auth.orgId, status: "open" } }),
    db.auditEvent.findMany({ where: { orgId: auth.orgId, action: { not: "candidate.viewed" } }, orderBy: { createdAt: "desc" }, take: 8 }),
  ]);
  const sourcing = isLiveSourceConnected();
  const steps: { n: number; title: string; detail: string; state: StepState; href: string; cta: string }[] = [
    { n: 1, title: "Create or import a role", detail: "Upload a job description or enter the details.", state: roles ? "done" : "todo", href: "/roles/new", cta: "New role" },
    {
      n: 2,
      title: "Define role criteria",
      detail: roles ? "Approve the criteria candidates are assessed against." : "Needs a role first.",
      state: approved ? "done" : roles ? "todo" : "blocked",
      href: "/roles",
      cta: "Open roles",
    },
    {
      n: 3,
      title: "Connect an approved sourcing provider",
      detail: sourcing ? "A licensed provider is connected." : "Optional. Without one, Discover searches your existing candidates; demo mode uses fictional people.",
      state: sourcing ? "done" : "optional",
      href: "/integrations",
      cta: "Integrations",
    },
    {
      n: 4,
      title: "Invite teammates or assign interviewers",
      detail: members > 1 || assignments ? "Your team is set up." : "Optional. Invite hiring managers and interviewers to work in this workspace.",
      state: members > 1 || assignments ? "done" : "optional",
      href: "/settings#team",
      cta: "Team",
    },
    {
      n: 5,
      title: "Review the first candidates",
      detail: inPipelines || decided ? "Shortlist, hold or reject — every decision is yours." : "Needs candidates in a role: add applicants or save people from Discover.",
      state: decided ? "done" : inPipelines ? "todo" : "blocked",
      href: "/roles",
      cta: "Review",
    },
  ];
  const required = steps.filter((s) => s.state !== "optional");
  const setupDone = required.every((s) => s.state === "done");
  const total = groups.reduce((n, g) => n + g.items.length, 0);

  return (
    <div className="space-y-8">
      <PageHeader
        title="Home"
        meta={
          <span>
            {auth.orgName} · {total ? `${total} item${total === 1 ? "" : "s"} need${total === 1 ? "s" : ""} a person` : "nothing waiting on you"}
            {roles > 0 && ` · ${openRoles} open role${openRoles === 1 ? "" : "s"} · ${inPipelines} candidate${inPipelines === 1 ? "" : "s"} in active pipelines`}
          </span>
        }
        actions={
          <>
            <LinkButton href="/discover/new">Start a search</LinkButton>
            <LinkButton href="/roles/new" variant="primary">
              New role
            </LinkButton>
          </>
        }
      />

      {!setupDone && (
        <section aria-labelledby="start-h">
          <h2 id="start-h" className="mb-1 text-[15px] font-semibold">
            Get started
          </h2>
          <p className="mb-3 text-[13px] text-muted">Five steps to your first reviewed candidates. Talyn prepares the work; you approve each decision.</p>
          <Card className="divide-y divide-line overflow-hidden">
            {steps.map((s) => (
              <div key={s.n} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <span
                  aria-hidden
                  className={clsx(
                    "flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[12px] font-semibold",
                    s.state === "done" ? "bg-ok text-white" : s.state === "blocked" ? "bg-sunken text-faint" : "border border-line-strong text-ink-2",
                  )}
                >
                  {s.state === "done" ? "✓" : s.n}
                </span>
                <div className="min-w-0 flex-1">
                  <div className={clsx("text-[13.5px] font-medium", s.state === "done" && "text-muted line-through decoration-faint")}>{s.title}</div>
                  <div className="text-[12.5px] text-muted">{s.detail}</div>
                </div>
                <span
                  className={clsx(
                    "rounded-md px-1.5 py-0.5 text-[11.5px] font-medium",
                    s.state === "done" ? "bg-ok-soft text-ok" : s.state === "todo" ? "bg-brand-soft text-brand" : s.state === "blocked" ? "bg-sunken text-muted" : "border border-line text-muted",
                  )}
                >
                  {STATE_LABEL[s.state]}
                </span>
                {s.state !== "done" && s.state !== "blocked" && (
                  <Link href={s.href} className="text-[13px] font-medium text-brand hover:underline">
                    {s.cta} →
                  </Link>
                )}
              </div>
            ))}
          </Card>
        </section>
      )}

      <section aria-labelledby="att-h">
        <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 id="att-h" className="text-[15px] font-semibold">
              Needs your attention
            </h2>
            <p className="text-[13px] text-muted">Each item opens the exact place to act. Talyn never decides, sends or schedules on its own.</p>
          </div>
          <Link href="/queue" className="text-[13px] text-muted underline-offset-2 hover:text-ink hover:underline">
            Full review queue
          </Link>
        </div>
        {groups.length === 0 ? (
          <EmptyState
            title={roles ? "You're caught up" : "Nothing to review yet"}
            body={roles ? "New applicants, search results, drafts and interviews will appear here as they need you." : "Create a role to start — applicants, discovery and interviews all hang off a role."}
            action={roles ? <LinkButton href="/roles">Go to roles</LinkButton> : <LinkButton href="/roles/new" variant="primary">New role</LinkButton>}
          />
        ) : (
          <div className="space-y-5">
            {groups.map((g) => (
              <div key={g.key}>
                <div className="mb-1.5 flex items-baseline gap-2">
                  <h3 className="text-[13.5px] font-semibold">{g.label}</h3>
                  <span className="text-[12px] tabular-nums text-muted">{g.items.length}</span>
                  <span className="hidden text-[12px] text-faint md:inline">— {g.hint}</span>
                </div>
                <Card className="divide-y divide-line overflow-hidden">
                  {g.items.slice(0, 6).map((it) => (
                    <Link key={it.key} href={it.href} className="group flex items-center gap-3 px-4 py-2.5 hover:bg-sunken/50">
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[13.5px] font-medium">{it.title}</div>
                        <div className="truncate text-[12.5px] text-muted">{it.detail}</div>
                      </div>
                      {it.at && <span className="hidden text-[11.5px] text-faint sm:inline">since {it.at.toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span>}
                      <span className="rounded-md border border-line-strong px-2 py-0.5 text-[12.5px] font-medium text-ink-2 group-hover:border-brand group-hover:text-brand">{it.action} →</span>
                    </Link>
                  ))}
                  {g.items.length > 6 && (
                    <Link href="/queue" className="block px-4 py-2 text-[12.5px] text-muted hover:text-ink">
                      {g.items.length - 6} more in the review queue
                    </Link>
                  )}
                </Card>
              </div>
            ))}
          </div>
        )}
      </section>

      {recent.length > 0 && (
        <section aria-labelledby="act-h">
          <h2 id="act-h" className="mb-2 text-[15px] font-semibold">
            Recent activity
          </h2>
          <Card className="divide-y divide-line overflow-hidden">
            {recent.map((e) => (
              <div key={e.id} className="flex flex-wrap items-center gap-x-2 px-4 py-2 text-[13px]">
                <span className="font-medium">{e.actorName || "Talyn"}</span>
                <span className="text-ink-2">{(AUDIT_LABEL[e.action] ?? e.action).toLowerCase()}</span>
                <span className="ml-auto text-[12px] text-faint">{formatDateTime(e.createdAt)}</span>
              </div>
            ))}
          </Card>
          <Link href="/settings/audit" className="mt-1.5 inline-block text-[12.5px] text-muted hover:text-ink">
            Full audit log
          </Link>
        </section>
      )}
    </div>
  );
}
