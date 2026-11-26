import { Logo } from "@/components/logo";
import { db } from "@/lib/db";
import { linkTokenHash } from "@/lib/loop/token";

export const metadata = { title: "Are you interested?" };

const DONE: Record<string, { title: string; body: string }> = {
  interested: { title: "Thanks — we'll be in touch", body: "The recruiter has your answer and will reach out with next steps." },
  not_now: { title: "Thanks for letting us know", body: "We won't follow up about this role for now." },
  declined: { title: "Understood", body: "We won't follow up about this role." },
};

/** Public: a candidate answers whether they want to hear more. One click, no login. */
export default async function InterestPage({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ done?: string }> }) {
  const { token } = await params;
  const { done } = await searchParams;
  const check = await db.interestCheck.findUnique({ where: { tokenHash: linkTokenHash(token) }, include: { application: { include: { role: { include: { org: { select: { name: true } } } } } } } });
  const valid = check && check.expiresAt > new Date();
  const role = check?.application.role;
  const answered = done && DONE[done] ? DONE[done] : check?.response && DONE[check.response] ? DONE[check.response] : null;
  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-4 py-12">
      <div className="mb-8">
        <Logo />
      </div>
      <div className="w-full max-w-md rounded-xl border border-line bg-surface p-6">
        {!valid || !role ? (
          <>
            <h1 className="text-[17px] font-semibold">This link has expired</h1>
            <p className="mt-2 text-[13.5px] text-muted">Reply to the message you received and the recruiter will pick it up.</p>
          </>
        ) : answered ? (
          <>
            <h1 className="text-[17px] font-semibold">{answered.title}</h1>
            <p className="mt-2 text-[13.5px] text-muted">{answered.body}</p>
          </>
        ) : (
          <form method="post" action={`/api/interest/${encodeURIComponent(token)}`}>
            <p className="text-[12.5px] font-medium uppercase tracking-wide text-faint">{role.clientCompanyName || role.org.name}</p>
            <h1 className="mt-1 text-[19px] font-semibold">{role.title}</h1>
            {role.location && <p className="text-[13.5px] text-muted">{role.location}</p>}
            <p className="mt-4 text-[14px]">Would you like to hear more about this role?</p>
            <div className="mt-4 grid gap-2">
              <button name="response" value="interested" className="rounded-lg bg-ink px-4 py-2.5 text-[14px] font-medium text-white">
                Yes, I&apos;m interested
              </button>
              <button name="response" value="not_now" className="rounded-lg border border-line-strong px-4 py-2.5 text-[14px] font-medium">
                Not right now
              </button>
              <button name="response" value="declined" className="rounded-lg px-4 py-2 text-[13.5px] text-muted hover:text-ink">
                No thanks
              </button>
            </div>
            <p className="mt-4 text-[11.5px] text-faint">Your answer goes only to the recruiter for this role. Nothing else is shared.</p>
          </form>
        )}
      </div>
    </main>
  );
}
