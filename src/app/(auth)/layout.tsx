import { redirect } from "next/navigation";
import { Logo } from "@/components/logo";
import { getAuth } from "@/lib/auth";

export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  if (await getAuth()) redirect("/roles");
  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-4 py-12">
      <div className="mb-8">
        <Logo />
      </div>
      <div className="w-full max-w-sm">{children}</div>
      <p className="mt-10 max-w-sm text-center text-[12px] text-faint">
        AI suggests and explains. Recruiters review, edit and decide.
      </p>
    </main>
  );
}
