"use client";

import clsx from "clsx";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";
import { NavProgress, SlidingIndicator } from "./nav-motion";
import { createWorkspace, switchWorkspace } from "@/server/team-actions";
import { logout } from "@/server/auth-actions";
import { ActionForm, FormMessage, SubmitButton, useServerForm } from "./client";
import { OpenPaletteButton } from "./command-palette";
import { Logo } from "./logo";

type Workspace = { id: string; name: string; role: string };
const ROLE_LABEL: Record<string, string> = { admin: "Admin", recruiter: "Recruiter", hiring_manager: "Hiring manager" };

const PRIMARY = [
  { href: "/home", label: "Home", icon: "home" },
  { href: "/roles", label: "Roles", icon: "roles" },
  { href: "/discover", label: "Discover", icon: "discover" },
  { href: "/candidates", label: "Candidates", icon: "people" },
  { href: "/interviews", label: "Interviews", icon: "interviews" },
  { href: "/integrations", label: "Integrations", icon: "plug" },
] as const;
const SECONDARY = [
  { href: "/settings", label: "Workspace settings" },
  { href: "/settings#team", label: "Team & permissions" },
  { href: "/settings/calibration", label: "Calibration" },
  { href: "/import", label: "Import & export" },
  { href: "/guide", label: "Guide" },
] as const;

/**
 * App shell: workspace switcher, primary areas, a quieter workspace section, and the account menu.
 * On small screens it collapses to a top bar with a drawer.
 */
export function AppShell({
  workspaces,
  activeOrgId,
  orgName,
  user,
  ai,
  attention,
  children,
}: {
  workspaces: Workspace[];
  activeOrgId: string;
  orgName: string;
  user: { name: string; email: string; role: string };
  ai: { configured: boolean; model: string | null };
  attention: number;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const path = usePathname();
  useEffect(() => setOpen(false), [path]);
  const sidebar = (
    <div className="flex h-full flex-col">
      <div className="px-3 pt-3">
        <WorkspaceSwitcher workspaces={workspaces} activeOrgId={activeOrgId} orgName={orgName} role={user.role} />
      </div>
      <div className="px-3 pt-3">
        <OpenPaletteButton />
      </div>
      <nav aria-label="Primary" className="mt-2 px-3">
        <SlidingIndicator id="primary-nav" variant="pill" className="flex flex-col gap-0.5">
        {PRIMARY.map((i) => {
          const active = path === i.href || path.startsWith(i.href + "/") || false;
          return (
            <Link
              key={i.href}
              href={i.href}
              aria-current={active ? "page" : undefined}
              className={clsx(
                "group relative flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-[13.5px] font-medium transition-colors",
                active ? "text-brand" : "text-ink-2 hover:bg-sunken hover:text-ink",
              )}
            >
              <NavIcon name={i.icon} />
              {i.label}
              {i.href === "/home" && attention > 0 && (
                <span className="ml-auto rounded-full bg-brand px-1.5 text-[11px] font-semibold tabular-nums text-white" aria-label={`${attention} items need attention`}>
                  {attention > 99 ? "99+" : attention}
                </span>
              )}
            </Link>
          );
        })}
        </SlidingIndicator>
      </nav>
      <div className="mt-6 px-3">
        <div className="px-2.5 pb-1 text-[11px] font-semibold uppercase tracking-wide text-faint">Workspace</div>
        <nav aria-label="Workspace" className="flex flex-col gap-0.5">
          {SECONDARY.map((i) => {
            const active = path === i.href.split("#")[0] && !i.href.includes("#");
            return (
              <Link key={i.href} href={i.href} aria-current={active ? "page" : undefined} className={clsx("rounded-lg px-2.5 py-1 text-[13px]", active ? "text-ink" : "text-muted hover:bg-sunken hover:text-ink")}>
                {i.label}
              </Link>
            );
          })}
        </nav>
      </div>
      <div className="mt-auto space-y-2 border-t border-line px-3 py-3 text-[12px]">
        <Link href="/settings#ai" className="flex items-center gap-1.5 px-2.5 text-muted hover:text-ink" title={ai.configured ? `Model: ${ai.model}` : "AI assist is off — see Settings"}>
          <span className={clsx("inline-block h-1.5 w-1.5 rounded-full", ai.configured ? "bg-ok" : "bg-faint")} aria-hidden />
          {ai.configured ? "AI assist on" : "AI assist off"}
        </Link>
        <AccountMenu user={user} />
      </div>
    </div>
  );

  return (
    <div className="min-h-screen md:flex">
      <Suspense fallback={null}>
        <NavProgress />
      </Suspense>
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:rounded-lg focus:bg-surface focus:px-3 focus:py-2 focus:shadow">
        Skip to content
      </a>
      {/* Mobile top bar */}
      <div className="sticky top-0 z-30 flex items-center gap-3 border-b border-line bg-surface px-4 py-2.5 md:hidden">
        <button type="button" onClick={() => setOpen(true)} aria-label="Open navigation" aria-expanded={open} className="rounded-md p-1.5 hover:bg-sunken">
          <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
            <path d="M3 5h12M3 9h12M3 13h12" />
          </svg>
        </button>
        <Logo />
        <span className="ml-auto truncate text-[12.5px] font-medium text-ink-2">{orgName}</span>
      </div>
      {open && (
        <div className="fixed inset-0 z-40 md:hidden" role="dialog" aria-modal="true" aria-label="Navigation">
          <button type="button" aria-label="Close navigation" className="absolute inset-0 bg-ink/30" onClick={() => setOpen(false)} />
          <aside className="motion-sheet absolute inset-y-0 left-0 w-72 bg-surface shadow-xl">{sidebar}</aside>
        </div>
      )}
      <aside className="hidden border-r border-line bg-surface md:sticky md:top-0 md:block md:h-screen md:w-60 md:shrink-0">{sidebar}</aside>
      <main id="main" className="min-w-0 flex-1 px-4 py-6 md:px-10 md:py-8">
        <div className="mx-auto max-w-[1240px]">{children}</div>
      </main>
    </div>
  );
}

function WorkspaceSwitcher({ workspaces, activeOrgId, orgName, role }: { workspaces: Workspace[]; activeOrgId: string; orgName: string; role: string }) {
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [state, action, pending] = useServerForm(createWorkspace);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex w-full items-center gap-2.5 rounded-lg border border-line px-2.5 py-2 text-left hover:bg-sunken"
      >
        <span aria-hidden className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-ink text-[12px] font-semibold text-white">
          {orgName.trim().charAt(0).toUpperCase() || "W"}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-semibold text-ink">{orgName}</span>
          <span className="block truncate text-[11.5px] text-muted">{ROLE_LABEL[role] ?? role} · Talyn</span>
        </span>
        <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden className="text-faint">
          <path d="M3 4.5 6 1.5l3 3M3 7.5l3 3 3-3" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
        </svg>
      </button>
      {open && (
        <div role="menu" className="motion-fade absolute left-0 right-0 z-40 mt-1 rounded-lg border border-line-strong bg-surface p-1 shadow-lg">
          <div className="px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-faint">Workspaces</div>
          {workspaces.map((w) => (
            <button
              key={w.id}
              role="menuitemradio"
              aria-checked={w.id === activeOrgId}
              type="button"
              onClick={async () => {
                if (w.id === activeOrgId) return setOpen(false);
                const r = await switchWorkspace(w.id).catch(() => null);
                if (r?.error) setErr(r.error);
              }}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] hover:bg-sunken"
            >
              <span className="min-w-0 flex-1 truncate">{w.name}</span>
              <span className="text-[11px] text-muted">{ROLE_LABEL[w.role] ?? w.role}</span>
              {w.id === activeOrgId && <span aria-hidden className="text-brand">✓</span>}
            </button>
          ))}
          {err && <p className="px-2 text-[12px] text-danger">{err}</p>}
          <div className="my-1 border-t border-line" />
          {creating ? (
            <ActionForm action={action} pending={pending} className="space-y-1.5 p-2">
              <label htmlFor="ws-name" className="text-[12px] font-medium">
                New workspace name
              </label>
              <input id="ws-name" name="name" required maxLength={120} className="h-8 w-full rounded-md border border-line-strong px-2 text-[13px]" />
              <FormMessage state={state} />
              <SubmitButton size="sm" pendingLabel="Creating…">
                Create and switch
              </SubmitButton>
            </ActionForm>
          ) : (
            <button type="button" onClick={() => setCreating(true)} className="w-full rounded-md px-2 py-1.5 text-left text-[13px] text-muted hover:bg-sunken hover:text-ink">
              + Create a workspace
            </button>
          )}
          <p className="px-2 pb-1 pt-1 text-[11px] text-faint">Roles, candidates and settings stay separate per workspace.</p>
        </div>
      )}
    </div>
  );
}

function AccountMenu({ user }: { user: { name: string; email: string; role: string } }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button type="button" onClick={() => setOpen(!open)} aria-haspopup="menu" aria-expanded={open} className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left hover:bg-sunken">
        <span aria-hidden className="flex h-6 w-6 items-center justify-center rounded-full bg-sunken text-[11px] font-semibold text-ink-2">
          {user.name.trim().charAt(0).toUpperCase()}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[12.5px] font-medium text-ink">{user.name}</span>
          <span className="block truncate text-[11px] text-muted">{user.email}</span>
        </span>
      </button>
      {open && (
        <div role="menu" className="motion-fade absolute bottom-full left-0 right-0 mb-1 rounded-lg border border-line-strong bg-surface p-1 shadow-lg">
          <Link role="menuitem" href="/integrations#calendar" className="block rounded-md px-2 py-1.5 text-[13px] hover:bg-sunken">
            My calendar connection
          </Link>
          <form action={logout}>
            <button role="menuitem" className="w-full rounded-md px-2 py-1.5 text-left text-[13px] hover:bg-sunken">
              Sign out
            </button>
          </form>
        </div>
      )}
    </div>
  );
}

function NavIcon({ name }: { name: (typeof PRIMARY)[number]["icon"] }) {
  const p = { width: 16, height: 16, viewBox: "0 0 16 16", fill: "none", stroke: "currentColor", strokeWidth: 1.6, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true };
  switch (name) {
    case "home":
      return (
        <svg {...p}>
          <path d="M2.5 7 8 2.5 13.5 7v6a.5.5 0 0 1-.5.5h-3v-4h-4v4H3a.5.5 0 0 1-.5-.5z" />
        </svg>
      );
    case "roles":
      return (
        <svg {...p}>
          <rect x="2" y="4.5" width="12" height="9" rx="1.5" />
          <path d="M5.5 4.5V3a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v1.5" />
        </svg>
      );
    case "discover":
      return (
        <svg {...p}>
          <circle cx="7" cy="7" r="4.5" />
          <path d="m10.5 10.5 3.5 3.5" />
        </svg>
      );
    case "people":
      return (
        <svg {...p}>
          <circle cx="6" cy="5.5" r="2.5" />
          <path d="M1.5 13.5c.5-2.5 2.3-3.8 4.5-3.8s4 1.3 4.5 3.8M11 3.2a2.4 2.4 0 0 1 0 4.6M12.2 9.9c1.3.5 2 1.7 2.3 3.6" />
        </svg>
      );
    case "interviews":
      return (
        <svg {...p}>
          <path d="M2.5 3.5h11v7h-6l-3 2.5v-2.5h-2z" />
        </svg>
      );
    case "plug":
      return (
        <svg {...p}>
          <path d="M6 2v3M10 2v3M4.5 5h7v2.5a3.5 3.5 0 0 1-7 0zM8 11v3" />
        </svg>
      );
  }
}
