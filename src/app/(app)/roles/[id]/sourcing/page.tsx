import { redirect } from "next/navigation";

// Sourcing became the role's Discover tab.
export default async function SourcingRedirect({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string>> }) {
  const { id } = await params;
  const qs = new URLSearchParams(await searchParams).toString();
  redirect(`/roles/${id}/discover${qs ? `?${qs}` : ""}`);
}
