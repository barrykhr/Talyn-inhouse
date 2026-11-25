import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { candidateText, cosine, evidenceLines, fakeEmbed, hashText, meaningBand, meaningPoints, normalize, sourcedText, stripContact } from "../src/lib/semantic/core";
import { computeRelevance } from "../src/lib/sourcing/relevance";

describe("vectors", () => {
  it("normalizes to unit length and computes cosine", () => {
    const v = normalize([3, 4]);
    assert.ok(Math.abs(v[0] - 0.6) < 1e-9 && Math.abs(v[1] - 0.8) < 1e-9);
    assert.ok(Math.abs(cosine([1, 0], [1, 0]) - 1) < 1e-9);
    assert.equal(cosine([1, 0], [0, 1]), 0);
    assert.equal(cosine([0, 0], [1, 1]), 0);
  });
  it("hashes text stably and detects changes", () => {
    assert.equal(hashText("abc"), hashText("abc"));
    assert.notEqual(hashText("abc"), hashText("abd"));
  });
});

describe("what gets embedded", () => {
  it("leaves out names and contact details", () => {
    const t = candidateText({ currentTitle: "Backend Engineer", currentCompany: "Orbital Pay", location: "Pune", candidateSummary: "Reach me at omar@example.com or +91 98962 33790, https://linkedin.com/in/x" }, ["Skills: Go"], ["Built the payments ledger"]);
    assert.match(t, /Backend Engineer at Orbital Pay/);
    assert.match(t, /Skills: Go/);
    assert.doesNotMatch(t, /example\.com|98962|linkedin/);
  });
  it("uses the stored profile text for Discover results, or the quoted evidence", () => {
    assert.match(sourcedText({ currentTitle: "SRE", currentCompany: null, location: "Bengaluru", profileText: "payments-ledger: Go service", signalsJson: "[]" }), /payments-ledger/);
    assert.match(sourcedText({ currentTitle: null, currentCompany: null, location: null, profileText: null, signalsJson: JSON.stringify([{ quote: "Kafka consumers in production" }]) }), /Kafka consumers/);
  });
  it("strips emails, phones and links", () => assert.equal(stripContact("a@b.co x +1 (555) 123-4567 https://x.y").replace(/\s+/g, " ").trim(), "x"));
});

describe("evidenceLines", () => {
  it("keeps quotable lines of 25–300 characters, once each", () => {
    const l = evidenceLines("Short.\nLed the settlement migration to Kafka at 10x volume.\nLed the settlement migration to Kafka at 10x volume.\n" + "x".repeat(400));
    assert.deepEqual(l, ["Led the settlement migration to Kafka at 10x volume."]);
  });
});

describe("bands and points", () => {
  it("maps similarity to plain-language bands", () => assert.deepEqual([0.6, 0.5, 0.4, 0.2].map(meaningBand), ["strong", "good", "some", "weak"]));
  it("adds 0–10 relevance points, 0 without a similarity", () => {
    assert.deepEqual([null, 0.2, 0.25, 0.425, 0.6, 0.9].map(meaningPoints), [0, 0, 0, 5, 10, 10]);
  });
  it("feeds relevance without changing the minimum bar", () => {
    const signals = [{ category: "skill_required", term: "Go", matched: false }, { category: "skill_required", term: "Kafka", matched: false }];
    const a = computeRelevance(signals, null, null);
    const b = computeRelevance(signals, null, null, Date.now(), 0.6);
    assert.equal(b.score - a.score, 10);
    assert.equal(b.belowBar, a.belowBar);
    assert.deepEqual(b.meaning, { similarity: 0.6, points: 10 });
    assert.equal(a.meaning, null);
  });
});

describe("fakeEmbed (test stand-in)", () => {
  it("is deterministic and closer for shared words", () => {
    const q = fakeEmbed("payments ledger kafka");
    assert.deepEqual(q, fakeEmbed("payments ledger kafka"));
    assert.ok(cosine(q, fakeEmbed("built a payments ledger on kafka")) > cosine(q, fakeEmbed("frontend react design systems")));
  });
});
