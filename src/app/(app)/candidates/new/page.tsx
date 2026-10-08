import { PageHeader } from "@/components/ui";
import { requireAuth } from "@/lib/auth";
import { aiStatus } from "@/lib/ai";
import { db } from "@/lib/db";
import { NewCandidateForm } from "./new-candidate-form";

export const metadata = { title: "New candidate" };
// CV extraction runs in a server action on this page and can take a while.
export const maxDuration = 300;

export default async function NewCandidatePage({ searchParams }: { searchParams: Promise<{ role?: string }> }) {
  const auth = await requireAuth();
  const { role = "" } = await searchParams;
  const roles = await db.role.findMany({ where: { orgId: auth.orgId, status: { not: "closed" } }, select: { id: true, title: true }, orderBy: { title: "asc" } });
  return (
    <div className="max-w-3xl">
      <PageHeader title="New candidate" eyebrow="Candidates" />
      <NewCandidateForm roles={roles} roleId={roles.some((r) => r.id === role) ? role : ""} aiConfigured={aiStatus().configured} />
    </div>
  );
}
