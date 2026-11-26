import { db } from "@/lib/db";
import { logError } from "@/lib/log";
import { linkTokenHash } from "@/lib/loop/token";

const ALLOWED = ["interested", "not_now", "declined"] as const;

/** Records a candidate's own answer from the interest link. The first answer counts; later clicks just show it. */
export async function POST(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const form = await req.formData().catch(() => null);
  const response = String(form?.get("response") ?? "");
  const back = (q: string) => Response.redirect(new URL(`/interest/${encodeURIComponent(token)}${q}`, req.url), 303);
  if (!(ALLOWED as readonly string[]).includes(response)) return back("");
  const check = await db.interestCheck.findUnique({ where: { tokenHash: linkTokenHash(token) }, include: { application: { select: { id: true, orgId: true, roleId: true, candidateId: true } } } });
  if (!check || check.expiresAt < new Date()) return back("");
  if (check.response) return back(`?done=${check.response}`);
  try {
    await db.$transaction([
      db.interestCheck.update({ where: { id: check.id }, data: { response, respondedAt: new Date() } }),
      db.application.update({
        where: { id: check.applicationId },
        data: { interest: response, interestAt: new Date(), interestByName: "Candidate (interest link)", interestChannel: "other", interestSource: "Answered the interest check link" },
      }),
      db.auditEvent.create({
        data: { orgId: check.orgId, actorName: "Candidate", action: "interest.answered", subjectType: "application", subjectId: check.applicationId, applicationId: check.applicationId, roleId: check.application.roleId, candidateId: check.application.candidateId, metaJson: JSON.stringify({ response }) },
      }),
    ]);
  } catch (err) {
    logError("interest.record_failed", err);
    return back("");
  }
  return back(`?done=${response}`);
}
