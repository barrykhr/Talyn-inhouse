import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { audienceOf, outreachSystemPrompt, plainOutreach } from "../src/lib/outreach/prompt";

const base = { step: 1, firstName: "Omar", sender: "Priya", company: "Acme", role: { title: "Data Analyst", location: "Mumbai" }, evidenceTerms: ["Tableau"] };

describe("audienceOf", () => {
  it("treats only Discover finds as not applied", () => {
    assert.equal(audienceOf("discovered"), "discovered");
    assert.equal(audienceOf("applied"), "applicant");
    assert.equal(audienceOf(null), "applicant");
  });
});

describe("outreachSystemPrompt", () => {
  it("tells the AI an applicant applied and forbids cold-outreach phrasing", () => {
    const p = outreachSystemPrompt("email", "applicant");
    assert.match(p, /APPLIED/);
    assert.match(p, /thank them for applying/);
    assert.match(p, /never say you "came across" or "noticed"/);
  });
  it("keeps the no-relationship rules for people who did not apply", () => {
    const p = outreachSystemPrompt("email", "discovered");
    assert.match(p, /has NOT applied/);
    assert.match(p, /Never claim or imply the candidate is looking for a job/);
    assert.doesNotMatch(p, /thank them for applying/);
  });
  it("keeps the shared safety rules for both", () => {
    for (const a of ["applicant", "discovered"] as const) assert.match(outreachSystemPrompt("whatsapp", a), /Never invent details/);
  });
});

describe("plainOutreach", () => {
  it("replies to an applicant's application with a next step", () => {
    const m = plainOutreach({ ...base, channel: "email", audience: "applicant" });
    assert.match(m.subject, /Your application: Data Analyst at Acme/);
    assert.match(m.body, /Thank you for applying/);
    assert.match(m.body, /short call/);
    assert.doesNotMatch(m.body, /Would you be open|Your profile mentions/);
  });
  it("lets applicants withdraw in follow-ups", () => {
    assert.match(plainOutreach({ ...base, step: 2, channel: "email", audience: "applicant" }).body, /withdraw/);
    assert.match(plainOutreach({ ...base, step: 2, channel: "whatsapp", audience: "applicant" }).body, /withdraw/);
  });
  it("keeps the first-contact message for people found in Discover", () => {
    const m = plainOutreach({ ...base, channel: "email", audience: "discovered" });
    assert.match(m.body, /Would you be open to a short conversation/);
    assert.match(m.body, /Your profile mentions Tableau/);
  });
});
