import "server-only";
import type { AuthContext } from "./auth";
import { db } from "./db";
import { logError } from "./log";

/** A signed-in user, or a system actor (cron, provider webhook, candidate unsubscribe) with userId null. */
type Actor = { orgId: string; userId: string | null; userName: string };

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
export async function audit(auth: Actor, action: string, ref: Ref) {
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
  "rubric.changed": "Changed skill threshold or weights",
  "assessment.batch": "Reassessed candidates",
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
  "outreach.declined_recorded": "Recorded that the candidate declined",
  "outreach.sent": "Sent outreach message (email provider)",
  "decision.cleared": "Cleared decision (removed from shortlist)",
  "discover.searched": "Ran a Discover search",
  "discover.setup": "Set up Discover search fields",
  "whatsapp.permission": "Recorded WhatsApp permission",
  "team.invited": "Invited a teammate",
  "team.joined": "Joined the workspace",
  "team.role_changed": "Changed a member's role",
  "interview.kit_created": "Created interview kit",
  "interview.kit_updated": "Edited interview kit",
  "interview.kit_shared": "Shared interview kit with interviewers",
  "interview.assigned": "Assigned an interviewer",
  "interview.unassigned": "Removed an interviewer",
  "interview.scorecard_saved": "Saved scorecard draft",
  "interview.scorecard_submitted": "Submitted scorecard",
  "interview.scorecard_reopened": "Reopened a scorecard",
  "interview.debrief_comment": "Added debrief comment",
  "interview.decision": "Recorded team decision",
  "calendar.connected": "Connected Google Calendar",
  "calendar.disconnected": "Disconnected Google Calendar",
  "schedule.times_proposed": "Proposed interview times to candidate",
  "schedule.created": "Scheduled interview",
  "schedule.rescheduled": "Rescheduled interview",
  "schedule.cancelled": "Cancelled interview",
  "interest.recorded": "Recorded candidate interest",
  "discover.draft": "Drafted a message (not sent)",
  "sample.cleared": "Removed sample candidates",
  "outreach.delivered": "Delivery confirmed by email provider",
  "outreach.test_sent": "Sent a test email",
  "sourcing.file_imported": "Imported sourcing file",
  "ats.linked": "Linked workspace to ATS",
  "ats.unlinked": "Unlinked workspace from ATS",
  "ats.sync": "Ran ATS sync",
  "ats.conflict_resolved": "Resolved ATS conflict",
  "ats.stage_map_saved": "Saved ATS stage mapping",
  "ats.stage_queued": "Queued stage change for ATS",
  "questions.generated": "Generated questions",
  "priority.changed": "Changed recruiter priority",
};
