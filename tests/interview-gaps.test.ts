import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { gapProbes, templateProbe } from "../src/lib/interviews/gaps";

const item = (name: string, result: string, importance = "required", kind = "criterion", id: string | null = name) => ({ criterionId: id, criterionName: name, kind, importance, result, overrideResult: null, missingInfo: null });

describe("gapProbes", () => {
  it("lists unproven requirements with a probe, required first, skipping skills and supported items", () => {
    const g = gapProbes(
      [item("Mentoring", "not_stated", "preferred"), item("On-call ownership", "inferred"), item("Kafka", "not_stated", "required", "skill"), item("Payments", "supported"), item("Domain", "conflicting")],
      [],
      [],
      new Set(["On-call ownership"]),
    );
    assert.deepEqual(g.map((x) => x.criterionName), ["On-call ownership", "Domain", "Mentoring"]);
    assert.equal(g[0].status, "unclear");
    assert.equal(g[0].inKit, true);
    assert.equal(g[1].status, "conflicting");
    assert.ok(g.every((x) => x.source === "template"));
  });
  it("uses the candidate's follow-up question when there is one, unless rejected", () => {
    const g = gapProbes([item("On-call ownership", "not_stated")], [{ criterionId: "On-call ownership", criterionName: "On-call ownership", text: "What broke on your last on-call?", status: "approved" }], [], new Set());
    assert.equal(g[0].probe, "What broke on your last on-call?");
    assert.equal(g[0].source, "follow_up");
    const r = gapProbes([item("On-call ownership", "not_stated")], [{ criterionId: "On-call ownership", criterionName: "On-call ownership", text: "x", status: "rejected" }], [], new Set());
    assert.equal(r[0].source, "template");
  });
  it("respects a recruiter's correction", () => {
    assert.equal(gapProbes([{ ...item("Payments", "not_stated"), overrideResult: "supported" }], [], [], new Set()).length, 0);
  });
  it("adds the hiring team's questions", () => {
    const g = gapProbes([], [], [{ text: "Ask about team size" }], new Set());
    assert.equal(g[0].source, "hiring_team");
  });
});

describe("templateProbe", () => {
  it("asks an open, job-related question", () => {
    assert.match(templateProbe("Stakeholder reporting", "missing"), /^Tell me about a time your work involved stakeholder reporting/);
  });
});
