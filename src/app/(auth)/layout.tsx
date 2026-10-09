import { redirect } from "next/navigation";
import { Logo } from "@/components/logo";
import { OrbitLogo } from "@/components/orbit-logo";
import { getAuth } from "@/lib/auth";

export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  if (await getAuth()) redirect("/home");
  return (
    <main className="grid min-h-screen lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      <aside className="hidden items-center justify-center border-r border-line bg-sunken/60 p-10 lg:flex">
        <OrbitLogo />
      </aside>
      <div className="flex flex-col items-center justify-center px-4 py-12">
        <div className="mb-8 lg:hidden">
          <Logo />
        </div>
        <div className="w-full max-w-sm">{children}</div>
      </div>
    </main>
  );
}
