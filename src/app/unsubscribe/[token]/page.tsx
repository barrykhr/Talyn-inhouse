import { Logo } from "@/components/logo";

export const metadata = { title: "Unsubscribe" };

export default async function UnsubscribePage({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ done?: string; invalid?: string }> }) {
  const { token } = await params;
  const sp = await searchParams;
  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-4 py-12">
      <div className="mb-8">
        <Logo />
      </div>
      <div className="w-full max-w-sm rounded-xl border border-line bg-surface p-6 text-center">
        {sp.done ? (
          <>
            <h1 className="text-[16px] font-semibold">You won&apos;t be contacted again</h1>
            <p className="mt-2 text-[13px] text-muted">We&apos;ve recorded your request and stopped all messages to you.</p>
          </>
        ) : sp.invalid ? (
          <>
            <h1 className="text-[16px] font-semibold">This link isn&apos;t valid</h1>
            <p className="mt-2 text-[13px] text-muted">Reply to the email you received and ask not to be contacted — we&apos;ll honour it.</p>
          </>
        ) : (
          <form method="post" action={`/api/unsubscribe/${encodeURIComponent(token)}`}>
            <h1 className="text-[16px] font-semibold">Stop hearing from us?</h1>
            <p className="mt-2 text-[13px] text-muted">We&apos;ll stop all recruiting messages to you.</p>
            <input type="hidden" name="confirm" value="1" />
            <button type="submit" className="mt-4 rounded-md bg-ink px-4 py-2 text-[13px] font-medium text-white">
              Unsubscribe
            </button>
          </form>
        )}
      </div>
    </main>
  );
}
