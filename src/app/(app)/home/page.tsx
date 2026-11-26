import clsx from "clsx";
import Link from "next/link";
import { AUDIT_LABEL } from "@/lib/audit";
import { Card, EmptyState, LinkButton, formatDateTime } from "@/components/ui";
import { aiStatus } from "@/lib/ai";
import { aiHealth } from "@/lib/ai-health";
import { inboxFor } from "@/lib/inbox";
import { InboxList } from "@/components/inbox-list";
import { requireAuth } from "@/lib/auth";
import { db } from "@/lib/db";
import { isLiveSourceConnected } from "@/lib/sourcing/connectors";
import { embeddingStatus } from "@/lib/semantic/embed";
import { HomeSearch } from "./home-search";

export const metadata = { title: "Home" };

type StepState = "done" | "todo" | "optional" | "blocked";
const STATE_LABEL: Record<StepState, string> = { done: "Done", todo: "To do", optional: "Optional", blocked: "Blocked" };

/**
 * Home: one box to describe who you're looking for (search by meaning across the talent pool, or
 * jump to a role or candidate by name), then what needs a person now and setup for new workspaces.
 */
export default async function HomePage() {
  const auth = await requireAuth();
  const [inbox, roles, approved, members, assignments, decided, inPipelines, openRoles, recent] = await Promise.all([
    inboxFor(auth.orgId, auth.userId),
    db.role.count({ where: { orgId: auth.orgId } }),
    db.criterion.count({ where: { orgId: auth.orgId, status: "approved" } }),
    db.membership.count({ where: { orgId: auth.orgId } }),
    db.interviewAssignment.count({ where: { stage: { kit: { orgId: auth.orgId } } } }),
    db.application.count({ where: { orgId: auth.orgId, decision: { not: null } } }),
    db.application.count({ where: { orgId: auth.orgId, stage: { notIn: ["hired", "rejected"] } } }),
    db.role.count({ where: { orgId: auth.orgId, status: "open" } }),
    db.auditEvent.findMany({ where: { orgId: auth.orgId, action: { not: "candidate.viewed" } }, orderBy: { createdAt: "desc" }, take: 8 }),
  ]);
  // Daily digest: new people Discover found for each role since yesterday (still to review).
  const since = new Date(Date.now() - 24 * 3600_000);
  const found = await db.sourcedProfile.groupBy({ by: ["roleId"], where: { orgId: auth.orgId, status: "new", createdAt: { gte: since } }, _count: true });
  const foundRoles = found.length ? await db.role.findMany({ where: { orgId: auth.orgId, id: { in: found.map((f) => f.roleId) } }, select: { id: true, title: true } }) : [];
  const digest = found
    .map((f) => ({ role: foundRoles.find((r) => r.id === f.roleId), n: f._count }))
    .filter((d): d is { role: { id: string; title: string }; n: number } => !!d.role)
    .sort((a, b) => b.n - a.n);
  const openRoleList = await db.role.findMany({
    where: { orgId: auth.orgId, status: "open" },
    orderBy: { updatedAt: "desc" },
    take: 3,
    select: { title: true, location: true, criteria: { where: { status: "approved", kind: "skill", importance: "required" }, orderBy: { position: "asc" }, take: 2, select: { name: true } } },
  });
  // Suggested searches from the workspace's own open roles, then two general ones.
  const suggestions = Array.from(
    new Set([
      ...openRoleList.map((r) => [r.title, r.criteria.length ? `with ${r.criteria.map((c) => c.name).join(" and ")}` : "", r.location ? `in ${r.location}` : ""].filter(Boolean).join(" ")),
      "Someone who has led a migration to the cloud",
      "Data people who have run A/B tests end to end",
    ]),
  ).slice(0, 4);
  const meaning = embeddingStatus();
  const firstName = auth.userName.split(/\s+/)[0] || auth.userName;
  const sourcing = isLiveSourceConnected();
  const ai = aiStatus();
  const health = ai.configured ? await aiHealth(ai.provider) : null;
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
  const total = inbox.count;

  return (
    <div className="space-y-8">
      <section aria-labelledby="home-h" className="flex flex-col items-center px-1 pb-4 pt-[8vh] text-center">
        <h1 id="home-h" className="mb-1.5 text-balance text-[28px] font-semibold tracking-tight sm:text-[32px]">
          Hi {firstName}, who are you looking for?
        </h1>
        <p className="mb-6 max-w-[60ch] text-[13.5px] text-muted">
          Describe the person in plain words. Talyn searches your candidates and everyone found in Discover by meaning, and shows the line behind each match.
        </p>
        <HomeSearch suggestions={suggestions} meaningReady={meaning.configured} meaningNote={meaning.reason} />
        <nav aria-label="Quick actions" className="mt-6 flex flex-wrap justify-center gap-x-4 gap-y-1 text-[13px]">
          <Link href="/roles/new" className="font-medium text-brand hover:underline">
            New role
          </Link>
          <Link href="/discover/new" className="text-muted hover:text-ink hover:underline">
            Start a Discover search
          </Link>
          <Link href="/inbox" className="text-muted hover:text-ink hover:underline">
            Inbox{total ? ` (${total})` : ""}
          </Link>
          <span className="text-faint">
            {auth.orgName}
            {roles > 0 && ` · ${openRoles} open role${openRoles === 1 ? "" : "s"} · ${inPipelines} in active pipelines`}
          </span>
        </nav>
      </section>

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

      {health?.failing && (
        <div role="alert" className="rounded-xl border border-danger/30 bg-danger-soft px-4 py-3 text-[13px]">
          <div className="font-semibold text-danger">AI requests are failing</div>
          <p className="mt-0.5 text-ink">
            {health.text} AI assessment and drafting fall back to labelled non-AI methods until it&apos;s fixed.{" "}
            {auth.membershipRole === "admin" ? (
              <Link href="/settings#ai" className="font-medium text-brand hover:underline">
                How to fix it →
              </Link>
            ) : (
              "Let a workspace admin know."
            )}
          </p>
        </div>
      )}

      <section aria-labelledby="att-h">
        <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 id="att-h" className="text-[15px] font-semibold">
              Needs you
            </h2>
            <p className="text-[13px] text-muted">The oldest five from your inbox. Each opens the exact place to act; Talyn never decides, sends or schedules on its own.</p>
          </div>
          {total > 5 && (
            <Link href="/inbox" className="text-[13px] font-medium text-brand underline-offset-2 hover:underline">
              See all {total} →
            </Link>
          )}
        </div>
        {roles === 0 && total === 0 ? (
          <EmptyState title="Nothing to review yet" body="Create a role to start: applicants, discovery and interviews all hang off a role." action={<LinkButton href="/roles/new" variant="primary">New role</LinkButton>} />
        ) : (
          <InboxList groups={inbox.groups} limit={5} compact />
        )}
      </section>

      {digest.length > 0 && (
        <section aria-labelledby="found-h">
          <h2 id="found-h" className="mb-2 text-[15px] font-semibold">
            Found since yesterday
          </h2>
          <Card className="divide-y divide-line overflow-hidden">
            {digest.map((d) => (
              <Link key={d.role.id} href={`/roles/${d.role.id}/discover`} className="motion-row flex items-center justify-between gap-3 px-4 py-2.5 text-[13.5px] hover:bg-sunken/60">
                <span className="min-w-0 truncate font-medium">{d.role.title}</span>
                <span className="shrink-0 text-muted">
                  {d.n} new {d.n === 1 ? "person" : "people"} to review →
                </span>
              </Link>
            ))}
          </Card>
        </section>
      )}

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
