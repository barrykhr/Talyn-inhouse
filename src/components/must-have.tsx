import { Badge } from "@/components/ui";
import { MUST_HAVE_LABEL, type MustHaveResult } from "@/lib/loop/must-have";

/** Shows whether someone meets the role's must-haves. Ordering aid only; never hides anyone. */
export function MustHaveBadge({ r }: { r: MustHaveResult }) {
  if (r.state === "none") return null;
  const title =
    r.state === "met"
      ? "The evidence shows every must-have"
      : r.state === "missing"
        ? `Evidence against: ${r.missing.join(", ")}${r.unconfirmed.length ? `. Not confirmed: ${r.unconfirmed.join(", ")}` : ""}. Ranked below people who meet them; check before deciding.`
        : `Not confirmed yet: ${r.unconfirmed.join(", ")}. Missing evidence isn't proof they lack it.`;
  return (
    <Badge tone={r.state === "met" ? "ok" : r.state === "missing" ? "danger" : "warn"} title={title}>
      {r.state === "missing" ? `Lacks must-have: ${r.missing[0]}${r.missing.length > 1 ? ` +${r.missing.length - 1}` : ""}` : MUST_HAVE_LABEL[r.state]}
    </Badge>
  );
}
