import "server-only";
import { aiStatus } from "@/lib/ai";
import type { AuthContext } from "@/lib/auth";
import { db } from "@/lib/db";
import { ORIGIN_LABEL } from "@/lib/domain";
import { getEmailProvider } from "@/lib/outreach/provider";
import { renderTemplatePreview, waNumber, whatsappConfigured, whatsappTemplate } from "@/lib/outreach/whatsapp";
import type { OutreachView } from "@/app/(app)/candidates/[id]/outreach";

/** Everything the outreach panel needs for one application, scoped to the org. */
export async function loadOutreachView(auth: AuthContext, applicationId: string): Promise<OutreachView | null> {
  const app = await db.application.findFirst({
    where: { id: applicationId, orgId: auth.orgId },
    include: { candidate: true, role: { select: { title: true } } },
  });
  if (!app) return null;
  const c = app.candidate;
  const [sequences, templates, org] = await Promise.all([
    db.outreachSequence.findMany({
      where: { orgId: auth.orgId, applicationId },
      orderBy: { createdAt: "desc" },
      take: 3,
      include: { messages: { orderBy: { step: "asc" } }, events: { orderBy: { createdAt: "desc" }, take: 60 } },
    }),
    db.outreachTemplate.findMany({ where: { orgId: auth.orgId }, select: { id: true, name: true }, orderBy: { updatedAt: "desc" }, take: 30 }),
    db.organization.findUniqueOrThrow({ where: { id: auth.orgId }, select: { name: true } }),
  ]);
  const origins = JSON.parse(c.fieldOriginsJson || "{}") as Record<string, string>;
  const originOf = (f: string) => ORIGIN_LABEL[origins[f] ?? ""] ?? (c.source === "csv" ? "CSV import" : c.source === "ats" ? "From ATS" : "Entered by recruiter");
  const seq = sequences.find((x) => ["draft", "active", "paused"].includes(x.status)) ?? sequences[0] ?? null;
  const email = getEmailProvider();
  const tpl = whatsappTemplate();
  return {
    applicationId: app.id,
    candidateId: c.id,
    candidateName: c.fullName,
    roleTitle: app.role.title,
    origin: app.origin,
    isSample: c.isSample,
    email: c.email,
    emailOrigin: c.email ? originOf("email") : null,
    phone: c.phone,
    phoneOrigin: c.phone ? originOf("phone") : null,
    phoneIntl: !!waNumber(c.phone),
    optedOut: c.contactOptOut,
    whatsappPermission: { status: c.whatsappPermission, at: c.whatsappPermissionAt?.toISOString() ?? null, note: c.whatsappPermissionNote, by: c.whatsappPermissionBy },
    interest: { value: app.interest, at: app.interestAt?.toISOString() ?? null, by: app.interestByName, note: app.interestNote },
    aiConfigured: aiStatus().configured,
    emailProvider: { connected: !!email, label: email?.label ?? null },
    whatsapp: {
      connected: whatsappConfigured(),
      templateName: tpl.name || null,
      templatePreview: renderTemplatePreview({ first_name: c.fullName.split(/\s+/)[0], role_title: app.role.title, company: org.name, recruiter_name: auth.userName, message: "[your approved message]" }),
      usesMessageParam: tpl.params.includes("message"),
    },
    company: org.name,
    senderName: auth.userName,
    templates,
    sequence: seq && {
      id: seq.id,
      channel: seq.channel === "whatsapp" ? "whatsapp" : "email",
      status: seq.status,
      stopReason: seq.stopReason,
      activatedByName: seq.activatedByName,
      activatedAt: seq.activatedAt?.toISOString() ?? null,
      messages: seq.messages.map((m) => ({
        id: m.id,
        step: m.step,
        delayDays: m.delayDays,
        subject: m.subject,
        body: m.body,
        edited: m.subject !== m.draftSubject || m.body !== m.draftBody,
        personalization: JSON.parse(m.personalizationJson),
        generator: m.generator,
        status: m.status,
        approvedByName: m.approvedByName,
        dueAt: m.dueAt?.toISOString() ?? null,
        sentAt: m.sentAt?.toISOString() ?? null,
        sentVia: m.sentVia,
        deliveredAt: m.deliveredAt?.toISOString() ?? null,
      })),
      events: seq.events.map((e) => ({ id: e.id, type: e.type, actorName: e.actorName, providerConfirmed: e.providerConfirmed, note: e.note, createdAt: e.createdAt.toISOString() })),
    },
  };
}
