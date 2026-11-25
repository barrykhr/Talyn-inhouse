import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { cleanTitles, jdLines, mergeChecks, ruleChecks, verifyChecks } from "../src/lib/role-insights";

const JD = `Senior Backend Engineer
We want a rockstar who thrives in a fast-paced environment.
- Candidates must be under 35 years old.
- Graduates from tier 1 colleges preferred.
- 10+ years of experience; this is a mid-level role.
- Own the payments ledger and on-call rotation.`;

describe("ruleChecks", () => {
  it("flags protected characteristics and proxies, quoting the JD line", () => {
    const r = ruleChecks(JD);
    assert.equal(r.length, 2);
    assert.ok(r.every((c) => c.kind === "exclusionary" && c.by === "rule" && c.verified));
    assert.ok(r.some((c) => /under 35 years old/.test(c.quote)));
    assert.ok(r.some((c) => /tier 1 colleges/.test(c.quote)));
  });
  it("finds nothing in a clean JD", () => {
    assert.deepEqual(ruleChecks("Own the payments ledger. Work with Go and PostgreSQL."), []);
  });
});

describe("verifyChecks", () => {
  it("marks quotes found in the JD as verified and others as not", () => {
    const out = verifyChecks(
      [
        { kind: "vague", quote: "rockstar who thrives", issue: "Vague", suggestion: "Say what they own" },
        { kind: "conflicting", quote: "15 years as a junior", issue: "Made up", suggestion: "x" },
        { kind: "missing", quote: "", issue: "No team size", suggestion: "Add it" },
      ],
      JD,
    );
    assert.deepEqual(out.map((c) => c.verified), [true, false, true]);
    assert.ok(out.every((c) => c.by === "ai"));
  });
});

describe("mergeChecks", () => {
  it("drops AI exclusionary checks that repeat a rule-flagged line", () => {
    const rule = ruleChecks(JD);
    const ai = verifyChecks(
      [
        { kind: "exclusionary", quote: "Candidates must be under 35 years old.", issue: "Age", suggestion: "Remove" },
        { kind: "vague", quote: "rockstar", issue: "Vague", suggestion: "Say what they own" },
      ],
      JD,
    );
    const m = mergeChecks(rule, ai);
    assert.equal(m.length, 3);
    assert.equal(m.filter((c) => c.kind === "exclusionary").length, 2);
  });
});

describe("helpers", () => {
  it("splits JD lines and strips bullets", () => {
    assert.ok(jdLines(JD).includes("Own the payments ledger and on-call rotation."));
  });
  it("cleans titles: trims, dedupes case-insensitively, caps", () => {
    assert.deepEqual(cleanTitles([" SDE II ", "sde ii", "Senior Engineer", "", "Staff", "Lead"], 3), ["SDE II", "Senior Engineer", "Staff"]);
  });
});
