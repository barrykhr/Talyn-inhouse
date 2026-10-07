import { PageHeader } from "@/components/ui";
import { createRole } from "@/server/role-actions";
import { RoleForm } from "../role-form";

export const metadata = { title: "New role" };

export default function NewRolePage() {
  return (
    <div className="max-w-3xl">
      <PageHeader title="New role" eyebrow="Roles" />
      <RoleForm action={createRole} submitLabel="Create role" cancelHref="/roles" />
    </div>
  );
}
