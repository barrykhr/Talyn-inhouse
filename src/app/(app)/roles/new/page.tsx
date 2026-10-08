import { PageHeader } from "@/components/ui";
import { NewRole } from "./new-role";

export const metadata = { title: "New role" };
// JD extraction steps run as server actions on this page and can take a while.
export const maxDuration = 300;

export default async function NewRolePage({ searchParams }: { searchParams: Promise<{ mode?: string }> }) {
  const { mode } = await searchParams;
  return (
    <div className="max-w-2xl">
      <PageHeader title="New role" eyebrow="Roles" />
      <NewRole key={mode} initialMode={mode === "manual" ? "manual" : "upload"} />
    </div>
  );
}
