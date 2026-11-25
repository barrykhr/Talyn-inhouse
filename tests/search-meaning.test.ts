import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { toDescribedFields } from "../src/lib/discovery/semantic";
import { EMPTY_FILTERS, cleanSynonyms, parseFilters, parseSynonyms, toBoolean } from "../src/lib/sourcing/filters";
import { computeRelevance } from "../src/lib/sourcing/relevance";

describe("cleanSynonyms", () => {
  it("keeps alternatives only for known terms, drops repeats of the term, caps at 4", () => {
    const out = cleanSynonyms({ Go: ["Golang", "go", "Golang", "Go lang", "GoLang 1.x", "Gopher", "extra"], Rust: ["rs"], " ": ["x"] }, ["Go", "Kafka"]);
    assert.deepEqual(out, { Go: ["Golang", "Go lang", "GoLang 1.x", "Gopher"] });
  });
  it("matches terms case-insensitively and returns the field's spelling", () => {
    assert.deepEqual(cleanSynonyms({ kubernetes: ["K8s"] }, ["Kubernetes"]), { Kubernetes: ["K8s"] });
  });
  it("survives bad input", () => {
    assert.deepEqual(parseSynonyms("nope"), {});
    assert.deepEqual(cleanSynonyms(null, null), {});
  });
});

describe("filters with synonyms", () => {
  const f = { ...EMPTY_FILTERS, titles: ["Backend Engineer"], skills_required: ["Go"], synonyms: { Go: ["Golang"] } };
  it("ORs alternatives into the Boolean query", () => {
    assert.match(toBoolean(f), /\(Go OR Golang\)/);
  });
  it("round-trips through stored JSON", () => {
    assert.deepEqual(parseFilters(JSON.stringify(f)).synonyms, { Go: ["Golang"] });
    assert.equal(parseFilters(JSON.stringify({ ...EMPTY_FILTERS })).synonyms, undefined);
  });
});

describe("relevance with an alternative name", () => {
  it("counts work that mentions the alternative toward depth", () => {
    const signals = [{ category: "skill_required", term: "Go", matched: true, matchedAs: "Golang" }];
    const r = computeRelevance(signals, { units: ["payments-ledger: Golang service", "infra: Golang CLI"], unitLabel: "repositories", lastActiveAt: null, popularity: null, popularityLabel: null }, null);
    assert.equal(r.depth[0].units, 2);
  });
});

describe("toDescribedFields", () => {
  it("trims, dedupes, keeps preferred distinct from required, and orders years", () => {
    const d = toDescribedFields({
      role_name: " Senior Backend Engineer ",
      alt_titles: ["SDE III", "sde iii", "Platform Engineer"],
      skills_required: ["Go", "PostgreSQL"],
      skills_preferred: ["go", "Kafka"],
      min_years: 9,
      max_years: 5,
      location: "Bengaluru",
      work_arrangement: "hybrid",
      other_needs: ["has scaled a payments system"],
    });
    assert.equal(d.roleName, "Senior Backend Engineer");
    assert.deepEqual(d.altTitles, ["SDE III", "Platform Engineer"]);
    assert.deepEqual(d.skillsPreferred, ["Kafka"]);
    assert.deepEqual([d.minYears, d.maxYears], [5, 9]);
    assert.equal(d.workArrangement, "hybrid");
    assert.deepEqual(d.otherNeeds, ["has scaled a payments system"]);
  });
  it("treats 'not stated' and impossible years as empty", () => {
    const d = toDescribedFields({ role_name: "Analyst", alt_titles: [], skills_required: [], skills_preferred: [], min_years: -1, max_years: 99, location: null, work_arrangement: "not stated", other_needs: [] });
    assert.deepEqual([d.minYears, d.maxYears, d.workArrangement, d.location], [null, null, null, null]);
  });
});
