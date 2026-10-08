import { Logo } from "@/components/logo";
import { NavLinks } from "@/components/nav";
import { aiStatus } from "@/lib/ai";
import { requireAuth } from "@/lib/auth";
import { logout } from "@/server/auth-actions";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const auth = await requireAuth();
  const ai = aiStatus();
  return (
    <div className="min-h-screen md:flex">
      <aside className="border-b border-line bg-paper md:sticky md:top-0 md:flex md:h-screen md:w-56 md:shrink-0 md:flex-col md:border-b-0 md:border-r">
        <div className="flex items-center justify-between px-4 py-3 md:block md:px-5 md:py-5">
          <Logo />
        </div>
        <NavLinks />
        <div className="hidden px-5 pb-5 text-[12px] md:mt-auto md:block">
          <div className="mb-3 flex items-center gap-1.5 text-muted" title={ai.configured ? `Model: ${ai.model}` : "See Settings to enable AI"}>
            <span className={`inline-block h-1.5 w-1.5 rounded-full ${ai.configured ? "bg-ok" : "bg-faint"}`} />
            {ai.configured ? "AI assist on" : "AI assist off"}
          </div>
          <div className="truncate font-medium text-ink">{auth.orgName}</div>
          <div className="truncate text-muted">{auth.userName}</div>
          <form action={logout}>
            <button className="mt-2 text-muted underline-offset-2 hover:text-ink hover:underline">Sign out</button>
          </form>
        </div>
      </aside>
      <main className="min-w-0 flex-1 px-4 py-6 md:px-10 md:py-8">
        <div className="mx-auto max-w-[1200px]">{children}</div>
      </main>
    </div>
  );
}
