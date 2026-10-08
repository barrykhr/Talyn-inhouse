import { googleConfigured } from "@/lib/google";
import { SignupForm } from "../auth-forms";

export const metadata = { title: "Create workspace" };

export default function SignupPage() {
  return <SignupForm google={googleConfigured()} />;
}
