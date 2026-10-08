import { createHash } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { PENDING_COOKIE } from "@/lib/google";
import { GoogleSignupForm } from "../../auth-forms";

export const metadata = { title: "Finish sign-up" };

export default async function GoogleSignupPage() {
  const token = (await cookies()).get(PENDING_COOKIE)?.value;
  const pending = token ? await db.pendingSignup.findUnique({ where: { id: createHash("sha256").update(token).digest("hex") } }) : null;
  if (!pending || pending.expiresAt < new Date()) redirect("/login?error=state");
  return <GoogleSignupForm name={pending.name} email={pending.email} />;
}
