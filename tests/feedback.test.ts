import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { feedbackSummary } from "../src/lib/feedback";

describe("feedbackSummary", () => {
  it("counts each verdict", () => {
    assert.equal(feedbackSummary([{ verdict: "interested" }, { verdict: "interested" }, { verdict: "question" }]), "2 interested · 1 question");
    assert.equal(feedbackSummary([{ verdict: "not_a_fit" }, { verdict: "question" }, { verdict: "question" }]), "1 not a fit · 2 questions");
  });
  it("says when there is none", () => assert.equal(feedbackSummary([]), "No feedback yet"));
});
