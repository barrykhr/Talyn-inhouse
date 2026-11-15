import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { bestQuote, relevanceBullets, topScoreFactors, truncate } from "../src/lib/candidate-summary";
import type { ProfileRow } from "../src/lib/profile-score";

describe("truncate", () => {
  it("leaves short text alone and cuts long text at a word with an ellipsis", () => {
    assert.equal(truncate("Built payment APIs in Go"), "Built payment APIs in Go");
    const long = "word ".repeat(60).trim();
    const out = truncate(long, 160);
    assert.ok(out.length <= 160);
    assert.ok(out.endsWith("…"));
  });
});

describe("bestQuote", () => {
  it("prefers a verified quote, then the more specific one", () => {
    const q = bestQuote([
      { quote: "Go", verified: true },
      { quote: "Led the payments platform migration to Go and PostgreSQL", verified: false },
      { quote: "Wrote Go services handling 2M requests a day", verified: true },
    ]);
    assert.equal(q?.quote, "Wrote Go services handling 2M requests a day");
    assert.equal(bestQuote([]), null);
  });
});

const row = (name: string, weight: number, credit: number | null, result = "supported"): ProfileRow => ({ name, kind: "skill", importance: "essential", result, corrected: false, weight, credit, points: credit === null ? null : weight * credit, evidence: 1 });

describe("topScoreFactors", () => {
  it("returns the biggest movers in score points, up or down", () => {
    const f = topScoreFactors([row("Go", 2, 1), row("Kafka", 2, 0, "not_stated"), row("AWS", 1, 0.5, "partially_supported"), row("Notes", 0, null)]);
    assert.deepEqual(
      f.map((x) => [x.name, x.direction, x.points]),
      [
        ["Go", "up", 40],
        ["Kafka", "down", 40],
        ["AWS", "up", 10],
      ],
    );
    assert.equal(f[1].why, "no evidence in the material");
  });
  it("returns nothing when no weighted item has a credit", () => assert.deepEqual(topScoreFactors([row("X", 0, null)]), []));
});

describe("relevanceBullets", () => {
  it("gives at most three bullets: strongest, biggest gap, to check", () => {
    const items = [
      { criterionName: "Go", importance: "essential", result: "supported", overrideResult: null },
      { criterionName: "PostgreSQL", importance: "essential", result: "supported", overrideResult: null },
      { criterionName: "Kafka", importance: "essential", result: "not_stated", overrideResult: null },
      { criterionName: "AWS", importance: "essential", result: "partially_supported", overrideResult: null },
      { criterionName: "Docker", importance: "preferred", result: "supported", overrideResult: null },
    ];
    const b = relevanceBullets(items);
    assert.equal(b.length, 3);
    assert.equal(b[0], "Strongest: Go, PostgreSQL");
    assert.match(b[1], /^Biggest gap: Kafka/);
    assert.equal(b[2], "To check: AWS");
  });
  it("uses the recruiter's correction", () => {
    const b = relevanceBullets([{ criterionName: "Kafka", importance: "essential", result: "not_stated", overrideResult: "supported" }]);
    assert.deepEqual(b, ["Strongest: Kafka"]);
  });
});
