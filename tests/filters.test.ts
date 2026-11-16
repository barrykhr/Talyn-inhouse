import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { EMPTY_FILTERS, FILTER_LABEL, parseFilters, toBoolean } from "../src/lib/sourcing/filters";

describe("target_companies in search filters", () => {
  it("is part of the empty filters and has a label", () => {
    assert.deepEqual(EMPTY_FILTERS.target_companies, []);
    assert.equal(FILTER_LABEL.target_companies, "Target companies");
  });
  it("is filled in when older saved searches lack it", () => {
    const f = parseFilters(JSON.stringify({ titles: ["Backend Engineer"] }));
    assert.deepEqual(f.target_companies, []);
    assert.deepEqual(parseFilters(JSON.stringify({ target_companies: ["Razorpay", 3] })).target_companies, ["Razorpay"]);
  });
  it("renders as a preference clause, not a filter", () => {
    const b = toBoolean({ ...EMPTY_FILTERS, titles: ["Backend Engineer"], target_companies: ["Razorpay", "Juspay"] });
    assert.equal(b, '"Backend Engineer" PREFER current_company:(Razorpay OR Juspay)');
    assert.equal(toBoolean({ ...EMPTY_FILTERS, titles: ["Backend Engineer"] }), '"Backend Engineer"');
  });
});
