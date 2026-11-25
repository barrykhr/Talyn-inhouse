import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { bandOf, candidateHealth, pipelineHealth, type HealthInput } from "../src/lib/health";

const now = new Date("2026-11-25T12:00:00Z");
const daysAgo = (n: number) => new Date(now.getTime() - n * 86_400_000);
const base: HealthInput = { stage: "recruiter_screen", stageSince: daysAgo(2), decision: null, assessedAt: null, lastContactAt: null, lastReplyAt: null, unansweredSent: 0, openTasks: 0, overdueTasks: 0, interest: "not_expressed", optedOut: false, bounced: false };

describe("candidateHealth", () => {
  it("is healthy when moving as expected", () => {
    const h = candidateHealth(base, now)!;
    assert.equal(h.score, 100);
    assert.equal(h.band, "healthy");
    assert.deepEqual(h.reasons, ["Moving as expected"]);
  });
  it("flags slow stages, silence and unanswered messages with reasons", () => {
    const h = candidateHealth({ ...base, stageSince: daysAgo(20), lastContactAt: daysAgo(16), unansweredSent: 3 }, now)!;
    assert.equal(h.band, "at_risk");
    assert.ok(h.reasons.some((r) => /20 days in this stage \(usual: 7\)/.test(r)));
    assert.ok(h.reasons.some((r) => /No contact for 16 days/.test(r)));
    assert.ok(h.reasons.some((r) => /3 messages without a reply/.test(r)));
  });
  it("uses what the candidate said, and opt-outs", () => {
    assert.equal(candidateHealth({ ...base, interest: "not_now" }, now)!.band, "watch");
    assert.equal(candidateHealth({ ...base, optedOut: true }, now)!.band, "at_risk");
    assert.equal(candidateHealth({ ...base, interest: "interested", lastReplyAt: daysAgo(1) }, now)!.score, 100);
  });
  it("flags an assessment waiting on a decision", () => {
    assert.ok(candidateHealth({ ...base, assessedAt: daysAgo(5) }, now)!.reasons[0].startsWith("Assessed 5 days ago"));
  });
  it("is null for hired or rejected", () => {
    assert.equal(candidateHealth({ ...base, stage: "hired" }, now), null);
    assert.equal(candidateHealth({ ...base, stage: "rejected" }, now), null);
  });
});

describe("pipelineHealth", () => {
  it("averages active candidates and names what to fix", () => {
    const ok = candidateHealth(base, now);
    const bad = candidateHealth({ ...base, stageSince: daysAgo(30), unansweredSent: 3 }, now);
    const p = pipelineHealth([{ stage: "recruiter_screen", health: ok }, { stage: "new", health: bad }, { stage: "hired", health: null }])!;
    assert.equal(p.active, 2);
    assert.equal(p.counts.at_risk, 1);
    assert.ok(p.reasons.some((r) => /Thin pipeline/.test(r)));
    assert.ok(p.reasons.includes("No one at interview or offer yet"));
  });
  it("is null with no active candidates", () => assert.equal(pipelineHealth([]), null));
});

describe("bandOf", () => {
  it("uses 75 and 50", () => assert.deepEqual([75, 74, 50, 49].map(bandOf), ["healthy", "watch", "watch", "at_risk"]));
});
