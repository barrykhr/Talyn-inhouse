import "server-only";
import type { AuthContext } from "./auth";
import { db } from "./db";
import { logError } from "./log";

type Ref = {
  subjectType: string;
  subjectId?: string | null;
  roleId?: string | null;
  candidateId?: string | null;
  applicationId?: string | null;
  /** Ids, counts, enum values only. Never names, contact details, document text or notes. */
  meta?: Record<string, string | number | boolean | null | undefined>;
};

/** Records a meaningful action. Never throws: an audit failure must not break the recruiter's work. */
export async function audit(auth: Pick<AuthContext, "orgId" | "userId" | "userName">, action: string, ref: Ref) {
  try {
    await db.auditEvent.create({
      data: {
        orgId: auth.orgId,
        actorId: auth.userId,
        actorName: auth.userName,
        action,
        subjectType: ref.subjectType,
        subjectId: ref.subjectId ?? null,
        roleId: ref.roleId ?? null,
        candidateId: ref.candidateId ?? null,
        applicationId: ref.applicationId ?? null,
        metaJson: JSON.stringify(ref.meta ?? {}),
      },
    });
  } catch (err) {
    logError("audit.write_failed", err, { action });
  }
}

/** Access events are throttled per actor+subject so routine browsing doesn't flood the log. */
export async function auditAccess(auth: Pick<AuthContext, "orgId" | "userId" | "userName">, action: string, ref: Ref, windowMinutes = 30) {
  try {
    const recent = await db.auditEvent.findFirst({
      where: { orgId: auth.orgId, actorId: auth.userId, action, subjectId: ref.subjectId ?? undefined, createdAt: { gte: new Date(Date.now() - windowMinutes * 60000) } },
      select: { id: true },
    });
    if (!recent) await audit(auth, action, ref);
  } catch (err) {
    logError("audit.access_failed", err, { action });
  }
}

export const AUDIT_LABEL: Record<string, string> = {
  "candidate.viewed": "Viewed candidate",
  "candidate.created": "Created candidate",
  "candidate.updated": "Edited profile",
  "candidate.deleted": "Deleted candidate and files",
  "candidate.added_to_role": "Added to role",
  "candidate.removed_from_role": "Removed from role",
  "resume.downloaded": "Downloaded CV file",
  "resume.uploaded": "Uploaded CV",
  "resume.deleted": "Deleted CV",
  "cv.extracted": "Extracted CV details",
  "cv.reviewed": "Reviewed CV extraction",
  "jd.uploaded": "Uploaded job description",
  "jd.downloaded": "Downloaded job description",
  "jd.extracted": "Extracted JD details",
  "jd.criteria_drafted": "Drafted criteria from JD",
  "jd.reviewed": "Reviewed JD extraction",
  "criteria.changed": "Changed approved criteria",
  "assessment.run": "Ran assessment",
  "assessment.corrected": "Corrected assessment result",
  "assessment.reviewed": "Marked assessment reviewed",
  "assessment.deleted": "Deleted assessment",
  "recommendation.reviewed": "Reviewed AI recommendation",
  "decision.recorded": "Recorded decision",
  "stage.changed": "Changed pipeline stage",
  "task.created": "Created task",
  "task.resolved": "Resolved task",
  "export.candidates": "Exported candidates CSV",
  "export.roles": "Exported roles CSV",
  "export.pipeline": "Exported pipeline CSV",
  "import.csv": "Imported candidates CSV",
  "org.retention_changed": "Changed retention setting",
  "retention.applied": "Applied retention (deleted inactive candidates)",
  "icp.generated": "Generated Ideal Candidate Profile",
  "icp.approved": "Approved Ideal Candidate Profile",
  "search.saved": "Saved search strategy",
  "search.run": "Ran sourcing search",
  "sourcing.saved_to_role": "Saved sourced profile to role",
  "sourcing.feedback": "Gave result feedback",
  "outreach.drafted": "Drafted outreach",
  "outreach.approved": "Approved outreach message",
  "outreach.activated": "Activated outreach sequence",
  "outreach.paused": "Paused outreach sequence",
  "outreach.stopped": "Stopped outreach sequence",
  "outreach.sent_recorded": "Recorded message as sent",
  "outreach.reply_recorded": "Recorded candidate reply",
  "outreach.opt_out_recorded": "Recorded opt-out",
  "questions.generated": "Generated questions",
  "priority.changed": "Changed recruiter priority",
};
