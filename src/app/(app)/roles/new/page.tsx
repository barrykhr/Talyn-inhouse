import { PageHeader } from "@/components/ui";
import { aiStatus } from "@/lib/ai";
import { NewRole } from "./new-role";

export const metadata = { title: "New role" };
// JD extraction runs in a server action on this page and can take a while.
export const maxDuration = 300;

export default function NewRolePage() {
  return (
    <div className="max-w-3xl">
      <PageHeader title="New role" eyebrow="Roles" />
      <NewRole aiConfigured={aiStatus().configured} />
    </div>
  );
}
