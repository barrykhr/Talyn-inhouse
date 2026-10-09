import Link from "next/link";
import { PageHeader } from "@/components/ui";
import { requireAuth } from "@/lib/auth";
import { db } from "@/lib/db";
import { NewDiscovery } from "./setup";

export const metadata = { title: "New discovery" };
// JD extraction runs as server actions from this page.
export const maxDuration = 300;

export default async function NewDiscoveryPage() {
  const auth = await requireAuth();
  const roles = await db.role.findMany({ where: { orgId: auth.orgId, status: { not: "closed" } }, select: { id: true, title: true }, orderBy: { updatedAt: "desc" }, take: 50 });
  return (
    <div className="max-w-4xl">
      <PageHeader eyebrow={<Link href="/discover" className="hover:text-ink">Discover</Link>} title="Set up a search" meta={<span>Start from a job description, or enter the role details yourself.</span>} />
      <NewDiscovery roles={roles} />
    </div>
  );
}
