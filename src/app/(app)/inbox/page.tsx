import { InboxList } from "@/components/inbox-list";
import { PageHeader } from "@/components/ui";
import { requireAuth } from "@/lib/auth";
import { inboxFor } from "@/lib/inbox";

export const metadata = { title: "Inbox" };

/** Everything waiting on you, grouped by what to do, oldest first. The bell shows the same list. */
export default async function InboxPage() {
  const auth = await requireAuth();
  const { groups, count } = await inboxFor(auth.orgId, auth.userId);
  return (
    <>
      <PageHeader title="Inbox" meta={<span>{count ? `${count} item${count === 1 ? " needs" : "s need"} you` : "Nothing needs you"} · Done hides an item until it changes; Snooze hides it for a day</span>} />
      <InboxList groups={groups} />
    </>
  );
}
