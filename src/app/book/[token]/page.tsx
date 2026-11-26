import { Logo } from "@/components/logo";
import { formatInZone } from "@/lib/calendar/time";
import { bookingFor } from "@/server/booking-link";

export const metadata = { title: "Pick an interview time" };

const ERR: Record<string, string> = {
  taken: "That time was just taken. Please pick another.",
  invalid: "Please pick one of the times below.",
  failed: "We couldn't book that time. Please try another, or reply to the message you received.",
};

/** Public: a candidate picks one of the times the recruiter proposed. No login. */
export default async function BookPage({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ done?: string; error?: string }> }) {
  const { token } = await params;
  const { done, error } = await searchParams;
  const b = await bookingFor(token);
  const tz = b?.s.timeZone ?? "UTC";
  const fmt = (t: number | Date) => formatInZone(t, tz, { weekday: "long", month: "long", day: "numeric", hour: "numeric", minute: "2-digit" });
  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-4 py-12">
      <div className="mb-8">
        <Logo />
      </div>
      <div className="w-full max-w-md rounded-xl border border-line bg-surface p-6">
        {done && b?.booked ? (
          <>
            <h1 className="text-[17px] font-semibold">You&apos;re booked</h1>
            <p className="mt-2 text-[14px]">{fmt(b.booked.startAt)} ({tz})</p>
            <p className="mt-2 text-[13px] text-muted">{b.booked.mode === "live" ? "A calendar invitation is on its way to you." : "The recruiter has your time and will send the invitation."}</p>
          </>
        ) : !b || b.expired || b.booked || !b.slots.length ? (
          <>
            <h1 className="text-[17px] font-semibold">{b?.booked ? "This interview is already booked" : "This link has expired"}</h1>
            <p className="mt-2 text-[13.5px] text-muted">Reply to the message you received and the recruiter will help.</p>
          </>
        ) : (
          <form method="post" action={`/api/book/${encodeURIComponent(token)}`}>
            <p className="text-[12.5px] font-medium uppercase tracking-wide text-faint">{b.s.stage.kit.application.role.clientCompanyName || b.s.stage.kit.application.role.org.name}</p>
            <h1 className="mt-1 text-[19px] font-semibold">{b.s.stage.name}</h1>
            <p className="text-[13.5px] text-muted">
              {b.s.stage.kit.application.role.title} · {b.s.durationMins} minutes
            </p>
            {error && ERR[error] && <p className="mt-3 rounded-md bg-warn-soft px-3 py-2 text-[13px]">{ERR[error]}</p>}
            <fieldset className="mt-4 space-y-2">
              <legend className="mb-1 text-[13.5px] font-medium">Pick a time ({tz})</legend>
              {b.slots.map((t, i) => (
                <label key={t} className="flex cursor-pointer items-center gap-3 rounded-lg border border-line-strong px-3 py-2.5 text-[14px] has-[:checked]:border-ink has-[:checked]:bg-sunken">
                  <input type="radio" name="start" value={t} defaultChecked={i === 0} required />
                  {fmt(t)}
                </label>
              ))}
            </fieldset>
            <button className="mt-4 w-full rounded-lg bg-ink px-4 py-2.5 text-[14px] font-medium text-white">Book this time</button>
            <p className="mt-3 text-[11.5px] text-faint">None of these work? Reply to the message you received with times that do.</p>
          </form>
        )}
      </div>
    </main>
  );
}
