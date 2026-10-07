import { PageHeader } from "@/components/ui";
import { requireAuth } from "@/lib/auth";
import { updateRole } from "@/server/role-actions";
import { ownRole } from "@/server/scope";
import { RoleForm } from "../../role-form";

export const metadata = { title: "Edit role" };

export default async function EditRolePage({ params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth();
  const { id } = await params;
  const role = await ownRole(auth, id);
  return (
    <div className="max-w-3xl">
      <PageHeader title="Edit role" eyebrow={role.title} />
      <RoleForm action={updateRole.bind(null, role.id)} initial={role} submitLabel="Save changes" cancelHref={`/roles/${role.id}`} />
    </div>
  );
}
