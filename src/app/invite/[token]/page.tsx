import { createHash } from "node:crypto";
import Link from "next/link";
import { Logo } from "@/components/logo";
import { getAuth } from "@/lib/auth";
import { db } from "@/lib/db";
import { AcceptExisting, AcceptNew } from "./forms";

export const metadata = { title: "Join workspace" };

const ROLE_LABEL: Record<string, string> = { recruiter: "Recruiter", hiring_manager: "Hiring manager", admin: "Admin" };

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const inv = await db.invite.findUnique({ where: { tokenHash: createHash("sha256").update(token).digest("hex") }, include: { org: { select: { name: true } } } });
  const valid = inv && !inv.acceptedAt && !inv.revokedAt && inv.expiresAt > new Date();
  const auth = valid ? await getAuth() : null;
  const existing = valid && !auth ? await db.user.findUnique({ where: { email: inv!.email }, select: { id: true } }) : null;
  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-4 py-12">
      <div className="mb-8">
        <Logo />
      </div>
      <div className="w-full max-w-sm rounded-xl border border-line bg-surface p-6">
        {!valid ? (
          <>
            <h1 className="text-[16px] font-semibold">This invite isn&apos;t valid</h1>
            <p className="mt-2 text-[13px] text-muted">It may have been used, revoked or expired. Ask a workspace admin for a new link.</p>
          </>
        ) : (
          <>
            <h1 className="text-[16px] font-semibold">Join {inv!.org.name}</h1>
            <p className="mt-1 text-[13px] text-muted">
              {inv!.invitedByName} invited {inv!.email} as {ROLE_LABEL[inv!.role] ?? inv!.role}.
            </p>
            <div className="mt-5">
              {auth ? (
                auth.email.toLowerCase() === inv!.email ? (
                  <AcceptExisting token={token} />
                ) : (
                  <p className="text-[13px] text-warn">
                    You&apos;re signed in as {auth.email}. This invite is for {inv!.email} — sign out and sign in with that account.
                  </p>
                )
              ) : existing ? (
                <p className="text-[13px]">
                  You already have a Talyn account.{" "}
                  <Link href={`/login?next=/invite/${token}`} className="font-medium underline">
                    Sign in to accept
                  </Link>
                </p>
              ) : (
                <AcceptNew token={token} name={inv!.name} email={inv!.email} />
              )}
            </div>
          </>
        )}
      </div>
    </main>
  );
}
