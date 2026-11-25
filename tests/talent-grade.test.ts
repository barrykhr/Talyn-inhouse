import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { talentGrade } from "../src/lib/profile-score";

describe("talentGrade", () => {
  it("maps the score to A+, A, B or C at 95, 80 and 65", () => {
    assert.deepEqual([100, 95, 94, 80, 79, 65, 64, 0].map(talentGrade), ["A+", "A+", "A", "A", "B", "B", "C", "C"]);
  });
  it("gives no grade without a score", () => {
    assert.equal(talentGrade(null), null);
    assert.equal(talentGrade(undefined), null);
  });
});
