import { redirect } from "next/navigation";
import { Logo } from "@/components/logo";
import { getAuth } from "@/lib/auth";

const STEPS = [
  ["Roles", "Criteria from your job description, approved by a recruiter."],
  ["Applicants & Discover", "Evidence for each person, with the source behind every claim."],
  ["Interviews", "Shared kits, independent scorecards and a team debrief."],
];

export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  if (await getAuth()) redirect("/home");
  return (
    <main className="grid min-h-screen lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      <aside className="hidden flex-col justify-between border-r border-line bg-sunken/60 p-10 lg:flex">
        <Logo />
        <div className="max-w-md">
          <h2 className="text-[22px] font-semibold leading-snug tracking-tight">In-house recruiting, with an assistant that shows its work.</h2>
          <ol className="mt-6 space-y-4">
            {STEPS.map(([t, d], i) => (
              <li key={t} className="flex gap-3">
                <span aria-hidden className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand-soft text-[12px] font-bold text-brand">{i + 1}</span>
                <div>
                  <div className="text-[14px] font-medium">{t}</div>
                  <p className="text-[13px] text-muted">{d}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
        <p className="text-[12px] text-faint">AI suggests and explains. Recruiters review, edit and decide.</p>
      </aside>
      <div className="flex flex-col items-center justify-center px-4 py-12">
        <div className="mb-8 lg:hidden">
          <Logo />
        </div>
        <div className="w-full max-w-sm">{children}</div>
        <p className="mt-10 max-w-sm text-center text-[12px] text-faint lg:hidden">AI suggests and explains. Recruiters review, edit and decide.</p>
      </div>
    </main>
  );
}
