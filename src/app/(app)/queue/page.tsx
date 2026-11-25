import { redirect } from "next/navigation";

/** The Queue became the Inbox (the bell, top right). Old links land there. */
export default function QueuePage() {
  redirect("/inbox");
}
