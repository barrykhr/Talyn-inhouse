import { GOOGLE_ERROR_MESSAGES, googleConfigured } from "@/lib/google";
import { LoginForm } from "../auth-forms";

export const metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string; next?: string }> }) {
  const { error, next } = await searchParams;
  return (
    <LoginForm
      google={googleConfigured()}
      next={next && /^\/invite\/[\w-]+$/.test(next) ? next : undefined}
      error={error ? GOOGLE_ERROR_MESSAGES[error] ?? GOOGLE_ERROR_MESSAGES.failed : undefined}
    />
  );
}
