import { GOOGLE_ERROR_MESSAGES, googleConfigured } from "@/lib/google";
import { LoginForm } from "../auth-forms";

export const metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  return <LoginForm google={googleConfigured()} error={error ? GOOGLE_ERROR_MESSAGES[error] ?? GOOGLE_ERROR_MESSAGES.failed : undefined} />;
}
