import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { answerChecks, extractAnswers, generatedPhrases, specificity } from "../src/lib/authenticity";

const SUMMARY = `Senior engineer.

Candidate's answers (WhatsApp, 3 Nov 2026, recorded by Priya):
I have 9 years of experience. I ran the settlement rotation for two years and cut pages by 60% with idempotency keys in PostgreSQL.

Candidate's answers (email, 5 Nov 2026, recorded by Priya):
Total experience is 6 years. I am passionate about leveraging cutting-edge technologies. Moreover, I believe in teamwork and delivering value to stakeholders across the organisation every day.`;

const CV = "Backend Engineer with 6 years of experience. Go, PostgreSQL, AWS.";

describe("extractAnswers", () => {
  it("splits recorded answer blocks with their channel", () => {
    const a = extractAnswers(SUMMARY);
    assert.equal(a.length, 2);
    assert.deepEqual(a.map((x) => x.channel), ["whatsapp", "email"]);
    assert.match(a[0].text, /settlement rotation/);
  });
  it("returns nothing without answers", () => assert.deepEqual(extractAnswers("Just a summary"), []));
});

describe("helpers", () => {
  it("scores specificity from numbers, named systems and first-hand actions", () => {
    assert.equal(specificity("I cut pages by 60% in PostgreSQL"), 3);
    assert.equal(specificity("I believe in teamwork and delivering value"), 0);
  });
  it("finds stock phrases", () => {
    assert.deepEqual(generatedPhrases("Moreover, I am passionate about leveraging tools."), ["moreover,", "passionate about leveraging"]);
  });
});

describe("answerChecks", () => {
  const checks = answerChecks({ answers: extractAnswers(SUMMARY), cv: CV, publicWork: "payments-ledger: Go service", prompts: ["Have you owned on-call for a payments service?"], skills: ["Go", "PostgreSQL", "Kafka"] });
  const by = (k: string) => checks.find((c) => c.key === k)!;
  it("runs all six checks", () => assert.equal(checks.length, 6));
  it("flags a timeline disagreement with both quotes", () => {
    assert.equal(by("timeline").status, "flag");
    assert.match(by("timeline").detail, /6 years.*9/);
    assert.equal(by("timeline").quotes.length, 2);
  });
  it("flags disagreement across channels", () => assert.equal(by("cross_channel").status, "flag"));
  it("flags a general answer but not a specific one", () => {
    assert.equal(by("specificity").status, "flag");
    assert.ok(by("specificity").quotes.every((q) => !/settlement/.test(q)));
  });
  it("flags stock phrases as possibly generated, never as proof", () => {
    assert.equal(by("generated").status, "flag");
    assert.match(by("generated").detail, /not proof/);
  });
  it("compares claimed skills with public work and the CV", () => {
    assert.equal(by("public_evidence").status, "flag"); // PostgreSQL not in public work
    assert.equal(by("skill_claims").status, "passed"); // PostgreSQL is in the CV
  });
  it("says when there isn't enough to check", () => {
    const c = answerChecks({ answers: [], cv: "", publicWork: "", prompts: [], skills: [] });
    assert.ok(c.every((x) => x.status === "not_enough"));
  });
});
