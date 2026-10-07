import { Badge } from "./ui";
import { ROLE_STATUS_LABEL, STAGE_LABEL, type RoleStatus, type Stage } from "@/lib/domain";

export function RoleStatusBadge({ status }: { status: string }) {
  const tone = status === "open" ? "ok" : status === "on_hold" ? "warn" : status === "closed" ? "gap" : "neutral";
  return <Badge tone={tone}>{ROLE_STATUS_LABEL[status as RoleStatus] ?? status}</Badge>;
}

export function StageBadge({ stage }: { stage: string }) {
  const tone = stage === "hired" ? "ok" : stage === "rejected" ? "gap" : stage === "offer" ? "signal" : "neutral";
  return <Badge tone={tone}>{STAGE_LABEL[stage as Stage] ?? stage}</Badge>;
}
