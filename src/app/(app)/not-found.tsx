import { LinkButton } from "@/components/ui";

export default function NotFound() {
  return (
    <div className="mx-auto max-w-md py-16 text-center">
      <h1 className="text-lg font-semibold">Not found</h1>
      <p className="mt-1 text-[13px] text-muted">This record doesn&apos;t exist or isn&apos;t part of your workspace.</p>
      <LinkButton href="/roles" className="mt-5">Back to roles</LinkButton>
    </div>
  );
}
