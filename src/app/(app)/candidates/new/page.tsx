import { PageHeader } from "@/components/ui";
import { requireAuth } from "@/lib/auth";
import { db } from "@/lib/db";
import { NewCandidateForm } from "./new-candidate-form";

export const metadata = { title: "New candidate" };

export default async function NewCandidatePage({ searchParams }: { searchParams: Promise<{ role?: string }> }) {
  const auth = await requireAuth();
  const { role = "" } = await searchParams;
  const roles = await db.role.findMany({ where: { orgId: auth.orgId, status: { not: "closed" } }, select: { id: true, title: true }, orderBy: { title: "asc" } });
  return (
    <div className="max-w-3xl">
      <PageHeader title="New candidate" eyebrow="Candidates" />
      <NewCandidateForm roles={roles} roleId={roles.some((r) => r.id === role) ? role : ""} />
    </div>
  );
}
