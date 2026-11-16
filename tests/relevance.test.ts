import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { computeRelevance } from "../src/lib/sourcing/relevance";

const sig = (category: string, term: string, matched: boolean) => ({ category, term, matched });

describe("computeRelevance with target companies", () => {
  const base = [sig("skill_required", "Go", true), sig("skill_required", "Kafka", false)];
  it("adds 10 when the current company is a target company", () => {
    const without = computeRelevance([...base, sig("company", "Target companies", false)], null, null);
    const withCo = computeRelevance([...base, sig("company", "Razorpay", true)], null, null);
    assert.equal(withCo.score - without.score, 10);
    assert.equal(withCo.companyMatched, true);
    assert.equal(without.companyMatched, false);
  });
  it("never goes above 100", () => {
    const r = computeRelevance([sig("skill_required", "Go", true), sig("title", "Backend Engineer", true), sig("company", "Razorpay", true)], null, null);
    assert.equal(r.score, 100);
  });
  it("doesn't filter: someone outside the targets still gets a score", () => {
    const r = computeRelevance([...base, sig("company", "Target companies", false)], null, null);
    assert.ok(r.score > 0);
  });
});
