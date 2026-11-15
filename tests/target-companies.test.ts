import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  cleanTargetCompanies,
  companyMatches,
  domainOf,
  filterByReasons,
  keepSeenUrls,
  normalizeCompanyName,
  targetCompaniesPrompt,
  type TargetCompanyInput,
} from "../src/lib/discovery/target-companies";

const company = (over: Record<string, unknown> = {}) => ({
  name: "Razorpay",
  website: "https://www.razorpay.com/",
  industry: "Financial services",
  domain: "Payments",
  product: "Payment gateway for businesses",
  headcount_band: "1,001-5,000",
  revenue_band: "$50-250M",
  match_reasons: ["same domain", "similar product"],
  reason: "Large payments engineering team",
  source_urls: [],
  ...over,
});

describe("normalizeCompanyName", () => {
  it("ignores case, punctuation and legal or generic suffixes", () => {
    assert.equal(normalizeCompanyName("Acme Technologies Pvt. Ltd."), "acme");
    assert.equal(normalizeCompanyName("ACME, Inc"), "acme");
    assert.equal(normalizeCompanyName("The Acme Group"), "acme");
  });
  it("keeps at least one word", () => {
    assert.equal(normalizeCompanyName("Technology Inc"), "technology");
    assert.equal(normalizeCompanyName(""), "");
  });
});

describe("domainOf", () => {
  it("reduces a website to its domain", () => {
    assert.equal(domainOf("https://www.Acme.com/about"), "acme.com");
    assert.equal(domainOf("acme.co.in"), "acme.co.in");
    assert.equal(domainOf("not a site"), "");
  });
});

describe("companyMatches", () => {
  it("matches a current company to a target ignoring suffixes", () => {
    assert.equal(companyMatches("Razorpay Software Private Limited", ["Razorpay", "Cred"]), "Razorpay");
    assert.equal(companyMatches("Freshworks", ["Razorpay"]), null);
    assert.equal(companyMatches(null, ["Razorpay"]), null);
  });
});

describe("cleanTargetCompanies", () => {
  it("drops invalid entries, duplicates, the client company and exclusions, and ranks the rest", () => {
    const raw = [
      company(),
      company({ name: "Razorpay Software Pvt Ltd", website: "" }), // duplicate by name
      company({ name: "RZP", website: "razorpay.com" }), // duplicate by website
      company({ name: "Acme Payments" }), // the client
      company({ name: "Paytm", website: "paytm.com" }), // excluded
      company({ name: "Cashfree", website: "cashfree.com", headcount_band: "about 800" }), // invalid band
      company({ name: "PhonePe", website: "phonepe.com", match_reasons: [] }), // no match reason
      { foo: "bar" }, // invalid
      company({ name: "Juspay", website: "juspay.in" }),
    ];
    const { companies, dropped } = cleanTargetCompanies(raw, { clientName: "Acme Payments Pvt Ltd", clientWebsite: "acmepay.com", exclusions: ["Paytm"] });
    assert.deepEqual(
      companies.map((c) => [c.rank, c.name, c.website]),
      [
        [1, "Razorpay", "razorpay.com"],
        [2, "Juspay", "juspay.in"],
      ],
    );
    const reasons = Object.fromEntries(dropped.map((d) => [d.name, d.reason]));
    assert.equal(reasons["Razorpay Software Pvt Ltd"], "duplicate");
    assert.equal(reasons["RZP"], "duplicate");
    assert.equal(reasons["Acme Payments"], "client company");
    assert.equal(reasons["Paytm"], "excluded");
    assert.equal(reasons["Cashfree"], "invalid");
    assert.equal(reasons["PhonePe"], "invalid");
    assert.equal(reasons["(unnamed)"], "invalid");
  });
  it("drops the client company by website too", () => {
    const { companies } = cleanTargetCompanies([company({ name: "Acme Pay", website: "acmepay.com" })], { clientName: "Acme", clientWebsite: "https://acmepay.com" });
    assert.equal(companies.length, 0);
  });
  it("keeps at most the limit", () => {
    const raw = Array.from({ length: 35 }, (_, i) => company({ name: `Company ${i}`, website: `c${i}.com` }));
    const { companies, dropped } = cleanTargetCompanies(raw, { limit: 30 });
    assert.equal(companies.length, 30);
    assert.equal(dropped.filter((d) => d.reason === "over limit").length, 5);
  });
});

describe("filterByReasons", () => {
  const list = [
    { name: "A", match_reasons: ["same domain", "similar headcount"] },
    { name: "B", match_reasons: ["same domain"] },
    { name: "C", match_reasons: ["same industry"] },
  ];
  it("shows everything for All (no chips)", () => assert.equal(filterByReasons(list, []).length, 3));
  it("keeps companies matched on every selected reason", () => {
    assert.deepEqual(filterByReasons(list, ["domain"]).map((c) => c.name), ["A", "B"]);
    assert.deepEqual(filterByReasons(list, ["domain", "headcount"]).map((c) => c.name), ["A"]);
  });
});

describe("keepSeenUrls", () => {
  it("keeps only https links the web search actually returned", () => {
    const seen = new Set(["https://razorpay.com/about/", "http://news.example.com/x"]);
    assert.deepEqual(keepSeenUrls(["https://razorpay.com/about", "https://made-up.example.com", "http://news.example.com/x"], seen), ["https://razorpay.com/about", "https://news.example.com/x"]);
  });
});

describe("targetCompaniesPrompt", () => {
  const input: TargetCompanyInput = {
    roleTitle: "Senior Backend Engineer",
    criteria: [{ name: "Go", importance: "essential", kind: "skill" }],
    brief: { altTitles: [], skillsRequired: ["Go"], skillsPreferred: [], location: "Bengaluru", workArrangement: "hybrid" },
    client: { name: "Acme Payments", website: "acmepay.com", notes: null },
    exclusions: ["Paytm"],
  };
  it("uses the profile, favours the role's location and lists exclusions", () => {
    const { system, user } = targetCompaniesPrompt(input, { industry: "Fintech", domain: "Payments", product: "Gateway", headcount_band: "201-1,000", revenue_band: "not known" });
    assert.match(system, /Favour companies with engineering or relevant teams in Bengaluru/);
    assert.match(system, /at most 30/);
    assert.match(user, /Exclusions \(never include\): Paytm/);
    assert.match(user, /Headcount: 201-1,000/);
  });
});
