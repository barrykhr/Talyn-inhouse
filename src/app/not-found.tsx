import { LinkButton } from "@/components/ui";

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center px-4 text-center">
      <h1 className="text-lg font-semibold">Page not found</h1>
      <p className="mt-1 text-[13px] text-muted">There&apos;s nothing at this address. If you followed a link inside Talyn, the record may have been deleted.</p>
      <LinkButton href="/home" className="mt-5">
        Go to Home
      </LinkButton>
    </main>
  );
}
