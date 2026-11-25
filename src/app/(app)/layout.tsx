import { AppShell } from "@/components/app-shell";
import { CommandPalette } from "@/components/command-palette";
import { ToastProvider } from "@/components/toast";
import { aiStatus } from "@/lib/ai";
import { aiHealth } from "@/lib/ai-health";
import { requireAuth } from "@/lib/auth";
import { db } from "@/lib/db";
import { logError } from "@/lib/log";
import { inboxCount } from "@/lib/inbox";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const auth = await requireAuth();
  const ai = aiStatus();
  const [memberships, inbox, health] = await Promise.all([
    db.membership.findMany({ where: { userId: auth.userId }, include: { org: { select: { id: true, name: true } } }, orderBy: { createdAt: "asc" } }),
    // The badge is a convenience: if counting fails, the shell still renders.
    inboxCount(auth.orgId, auth.userId).catch((err) => {
      logError("shell.inbox_count_failed", err);
      return 0;
    }),
    ai.configured ? aiHealth(ai.provider) : null,
  ]);
  return (
    <ToastProvider>
      <AppShell
        workspaces={memberships.map((m) => ({ id: m.org.id, name: m.org.name, role: m.role }))}
        activeOrgId={auth.orgId}
        orgName={auth.orgName}
        user={{ name: auth.userName, email: auth.email, role: auth.membershipRole }}
        ai={{ configured: ai.configured, model: ai.model ?? null, failing: health?.failing ? (health.text ?? "AI requests are failing") : null }}
        inboxCount={inbox}
      >
        {children}
      </AppShell>
      <CommandPalette />
    </ToastProvider>
  );
}
