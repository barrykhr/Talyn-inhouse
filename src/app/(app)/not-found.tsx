import { LinkButton } from "@/components/ui";

export default function NotFound() {
  return (
    <div className="mx-auto max-w-md py-16 text-center">
      <h1 className="text-lg font-semibold">Not found</h1>
      <p className="mt-1 text-[13px] text-muted">This page or record doesn&apos;t exist, or it belongs to a different workspace than the one you&apos;re in.</p>
      <LinkButton href="/home" className="mt-5">
        Go to Home
      </LinkButton>
    </div>
  );
}
