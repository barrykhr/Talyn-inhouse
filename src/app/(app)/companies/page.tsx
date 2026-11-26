import Link from "next/link";
import { Badge, Card, EmptyState, PageHeader } from "@/components/ui";
import { requireAuth } from "@/lib/auth";
import { listCompanies } from "@/server/company-view";

export const metadata = { title: "Companies" };

/** Every company you hire for, with its openings and what its calls show about how its hiring managers interview. */
export default async function CompaniesPage() {
  const auth = await requireAuth();
  const companies = await listCompanies(auth.orgId, auth.orgName);
  return (
    <>
      <PageHeader
        title="Companies"
        meta={<span className="text-[13px] text-muted">Each company you hire for, its openings, and how its hiring managers interview, built from calls checked against the JD.</span>}
      />
      {companies.length === 0 ? (
        <EmptyState title="No companies yet" body="Companies appear here once a role names the company it hires for." />
      ) : (
        <Card className="overflow-hidden">
          <ul className="divide-y divide-line">
            {companies.map((c) => (
              <li key={c.key} className="motion-row">
                <Link href={`/companies/${c.key}`} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 hover:bg-sunken/60">
                  <span className="min-w-0 flex-1">
                    <span className="block text-[14.5px] font-semibold">{c.name}</span>
                    <span className="block text-[12.5px] text-muted">
                      {c.open} open of {c.roles} role{c.roles === 1 ? "" : "s"} · {c.calls} call{c.calls === 1 ? "" : "s"} checked · {c.managers} hiring manager{c.managers === 1 ? "" : "s"}
                    </span>
                  </span>
                  {c.questionAlignment !== null && (
                    <Badge tone={c.questionAlignment >= 75 ? "ok" : c.questionAlignment >= 50 ? "warn" : "danger"} title="Average share of interview questions tied to the JD">
                      Questions on JD {c.questionAlignment}%
                    </Badge>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </>
  );
}
