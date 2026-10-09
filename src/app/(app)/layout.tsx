import { AppShell } from "@/components/app-shell";
import { CommandPalette } from "@/components/command-palette";
import { ToastProvider } from "@/components/toast";
import { aiStatus } from "@/lib/ai";
import { attentionCount } from "@/lib/attention";
import { requireAuth } from "@/lib/auth";
import { db } from "@/lib/db";
import { logError } from "@/lib/log";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const auth = await requireAuth();
  const ai = aiStatus();
  const [memberships, attention] = await Promise.all([
    db.membership.findMany({ where: { userId: auth.userId }, include: { org: { select: { id: true, name: true } } }, orderBy: { createdAt: "asc" } }),
    // The badge is a convenience: if counting fails, the shell still renders.
    attentionCount(auth.orgId).catch((err) => {
      logError("shell.attention_failed", err);
      return 0;
    }),
  ]);
  return (
    <ToastProvider>
      <AppShell
        workspaces={memberships.map((m) => ({ id: m.org.id, name: m.org.name, role: m.role }))}
        activeOrgId={auth.orgId}
        orgName={auth.orgName}
        user={{ name: auth.userName, email: auth.email, role: auth.membershipRole }}
        ai={{ configured: ai.configured, model: ai.model ?? null }}
        attention={attention}
      >
        {children}
      </AppShell>
      <CommandPalette />
    </ToastProvider>
  );
}
