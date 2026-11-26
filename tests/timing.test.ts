import assert from "node:assert/strict";
import { test } from "node:test";
import { parseCvDate, profileDiff, timingScore, workFacts } from "../src/lib/timing";

const now = new Date("2026-11-26T00:00:00Z");

test("CV dates as people write them", () => {
  assert.deepEqual(parseCvDate("Mar 2021"), { y: 2021, m: 3 });
  assert.deepEqual(parseCvDate("September 2019"), { y: 2019, m: 9 });
  assert.deepEqual(parseCvDate("03/2021"), { y: 2021, m: 3 });
  assert.deepEqual(parseCvDate("2021-03"), { y: 2021, m: 3 });
  assert.deepEqual(parseCvDate("2020"), { y: 2020, m: 1 });
  assert.equal(parseCvDate("Present"), "present");
  assert.equal(parseCvDate("Till date"), "present");
  assert.equal(parseCvDate("soon"), null);
  assert.equal(parseCvDate(""), null);
});

test("time in title and at company, across a promotion", () => {
  const w = workFacts(
    [
      { title: "Senior Engineer", employer: "Helio Pay", start: "Jan 2022", end: "Present", quote: "Senior Engineer, Helio Pay, Jan 2022 – Present" },
      { title: "Engineer", employer: "Helio Pay", start: "Jun 2019", end: "Dec 2021" },
      { title: "Intern", employer: "Other", start: "2018", end: "2019" },
    ],
    now,
  )!;
  assert.equal(w.title, "Senior Engineer");
  assert.equal(w.inTitleMonths, 58);
  assert.equal(w.atCompanyMonths, 89);
  assert.equal(workFacts([{ title: "X", employer: "Y", start: "", end: "Present" }], now), null);
  assert.equal(workFacts([{ title: "X", employer: "Y", start: "2019", end: "2021" }], now), null);
});

test("score: each signal adds or subtracts, bands, and nothing is invented without data", () => {
  const work = { employer: "Helio", title: "Senior Engineer", inTitleMonths: 40, atCompanyMonths: 60, quote: null };
  const layoffs = { type: "layoffs" as const, date: "2026-08", headline: "Cut 10% of staff", url: "https://news.example/a" };
  const a = timingScore({ work, events: [layoffs], changes: [], saidInterested: false, now });
  assert.equal(a.score, 85); // 30 + 25 + 30
  assert.equal(a.band, "good");
  assert.equal(a.signals.find((s) => s.label === "Layoffs")?.url, "https://news.example/a");
  const old = timingScore({ work: null, events: [{ ...layoffs, date: "2024-01" }], changes: [], saidInterested: false, now });
  assert.equal(old.score, null, "events older than 12 months don't count");
  assert.equal(old.band, "unknown");
  const moved = timingScore({ work: null, events: [], changes: [{ field: "company", from: "A", to: "B", seenAt: new Date("2026-11-01T00:00:00Z"), source: "GitHub" }], saidInterested: false, now });
  assert.equal(moved.score, 5);
  assert.equal(moved.band, "low");
  const capped = timingScore({ work, events: [layoffs, { ...layoffs, type: "restructuring" }], changes: [], saidInterested: true, now });
  assert.equal(capped.score, 100);
});

test("profile diffs: only real changes, case-insensitive", () => {
  const at = new Date("2026-11-01T00:00:00Z");
  const d = profileDiff({ currentTitle: "Engineer", currentCompany: "Helio", location: "Pune", headline: null }, { currentTitle: "engineer", currentCompany: "Corvid", location: "Pune", headline: "Open to platform roles" }, at, "GitHub");
  assert.deepEqual(
    d.map((x) => x.field),
    ["company", "headline"],
  );
  assert.equal(profileDiff({ currentTitle: null, currentCompany: null, location: null }, { currentTitle: "Engineer", currentCompany: "Helio", location: "Pune" }, at, "GitHub").length, 0, "first sighting isn't a change");
});
