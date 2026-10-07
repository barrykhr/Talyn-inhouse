import { Card, PageHeader, SectionTitle, buttonClass } from "@/components/ui";
import { requireAuth } from "@/lib/auth";
import { db } from "@/lib/db";
import { Importer } from "./importer";

export const metadata = { title: "Import & export" };

export default async function ImportPage({ searchParams }: { searchParams: Promise<{ role?: string }> }) {
  const auth = await requireAuth();
  const { role = "" } = await searchParams;
  const roles = await db.role.findMany({ where: { orgId: auth.orgId, status: { not: "closed" } }, select: { id: true, title: true }, orderBy: { title: "asc" } });
  const sample = "full_name,email,phone,location,current_title,current_company,linkedin_url,resume_text,notes";
  return (
    <>
      <PageHeader title="Import & export" />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <Importer roles={roles} defaultRole={roles.some((r) => r.id === role) ? role : ""} />
        <div className="space-y-5">
          <Card className="p-5">
            <SectionTitle hint="CSV files open in any spreadsheet tool.">Export</SectionTitle>
            <div className="flex flex-col gap-2">
              <a href="/api/export/candidates" className={buttonClass("secondary")}>All candidates (.csv)</a>
              <a href="/api/export/roles" className={buttonClass("secondary")}>Roles &amp; criteria (.csv)</a>
            </div>
            <p className="mt-3 text-[12.5px] text-muted">For a role&apos;s pipeline with per-criterion results, use “Export CSV” on the role page.</p>
          </Card>
          <Card className="p-5">
            <SectionTitle>CSV format</SectionTitle>
            <p className="text-[12.5px] text-muted">Recognised headers include:</p>
            <code className="mt-2 block break-all rounded-lg bg-sunken p-2 font-mono text-[11.5px] text-ink-2">{sample}</code>
            <p className="mt-2 text-[12.5px] text-muted">Only a name is required. Resume files can be attached afterwards on each profile.</p>
          </Card>
        </div>
      </div>
    </>
  );
}
