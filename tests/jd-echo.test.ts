import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { applyEchoGuard, echoSummary, echoesRequirement, longestSharedRun } from "../src/lib/jd-echo";
import type { Evidence } from "../src/lib/domain";

const ev = (quote: string, verified = true): Evidence => ({ quote, source: "resume", verified }) as Evidence;
const JD = "We are hiring a Data Analyst. You will build dashboards in Tableau or Power BI for business reporting and run experimentation and A/B test analysis with product teams.";

describe("echoesRequirement", () => {
  it("flags a quote that contains the whole criterion name", () => {
    assert.equal(echoesRequirement("Backend Engineer with 7 years. 3+ years of SQL for analysis; Building dashboards in Tableau or Power BI.", "3+ years of SQL for analysis"), "criterion");
  });
  it("flags a quote that copies a long run of the job description", () => {
    assert.equal(echoesRequirement("I build dashboards in Tableau or Power BI for business reporting daily", "Dashboard experience", JD), "jd");
  });
  it("does not flag a real description of the work", () => {
    assert.equal(echoesRequirement("Built the weekly revenue dashboard in Tableau used by 40 sales managers; cut report prep from 2 days to 2 hours.", "Building dashboards in Tableau or Power BI", JD), null);
  });
  it("ignores short criterion names, which CVs legitimately repeat", () => {
    assert.equal(echoesRequirement("Python, SQL, Tableau", "Python"), null);
    assert.equal(echoesRequirement("Used Power BI daily", "Power BI"), null);
  });
  it("ignores case and punctuation", () => {
    assert.equal(echoesRequirement("- STAKEHOLDER reporting, for business teams!", "Stakeholder reporting for business teams"), "criterion");
  });
});

describe("longestSharedRun", () => {
  it("counts consecutive shared words", () => {
    assert.equal(longestSharedRun("a b c d e", "x b c d y"), 3);
    assert.equal(longestSharedRun("", "a b"), 0);
  });
});

describe("applyEchoGuard", () => {
  const base = { kind: "criterion", explanation: "Explicitly stated.", missingInfo: "", confidence: "high" };
  it("downgrades a criterion whose only evidence repeats the requirement", () => {
    const { drafts, echoed } = applyEchoGuard([{ ...base, criterionName: "Stakeholder reporting for business teams", result: "supported", evidence: [ev("Stakeholder reporting for business teams.")] }]);
    assert.deepEqual(echoed, ["Stakeholder reporting for business teams"]);
    assert.equal(drafts[0].result, "inferred");
    assert.equal(drafts[0].confidence, "low");
    assert.match(drafts[0].explanation, /repeats the requirement's wording/);
    assert.ok(drafts[0].missingInfo.length > 0);
  });
  it("keeps the item when any verified quote describes real work", () => {
    const { drafts, echoed } = applyEchoGuard([
      { ...base, criterionName: "Stakeholder reporting for business teams", result: "supported", evidence: [ev("Stakeholder reporting for business teams."), ev("Presented monthly churn analysis to the CFO and sales heads.")] },
    ]);
    assert.deepEqual(echoed, []);
    assert.equal(drafts[0].result, "supported");
  });
  it("never touches single skills, missing items or unverified quotes", () => {
    const { drafts, echoed } = applyEchoGuard([
      { ...base, kind: "skill", criterionName: "Building dashboards in Tableau", result: "supported", evidence: [ev("Building dashboards in Tableau")] },
      { ...base, criterionName: "3+ years of SQL for analysis", result: "not_stated", evidence: [] },
      { ...base, criterionName: "3+ years of SQL for analysis", result: "supported", evidence: [ev("3+ years of SQL for analysis", false)] },
    ]);
    assert.deepEqual(echoed, []);
    assert.deepEqual(drafts.map((d) => d.result), ["supported", "not_stated", "supported"]);
  });
  it("uses the job description when given", () => {
    const { echoed } = applyEchoGuard([{ ...base, criterionName: "Dashboards", result: "partially_supported", evidence: [ev("Build dashboards in Tableau or Power BI for business reporting and run experimentation")] }], JD);
    assert.deepEqual(echoed, ["Dashboards"]);
  });
});

describe("echoSummary", () => {
  it("is null when nothing was copied", () => assert.equal(echoSummary([]), null));
  it("names the criteria, shortening long lists", () => {
    assert.match(echoSummary(["A b c", "D e f"])!, /2 criteria \(A b c, D e f\)/);
    assert.match(echoSummary(["a", "b", "c", "d", "e"])!, /\+2\)/);
    assert.match(echoSummary(["a"])!, /1 criterion/);
  });
});
