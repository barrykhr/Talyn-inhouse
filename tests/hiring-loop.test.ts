import assert from "node:assert/strict";
import { test } from "node:test";
import { readyToLearn, reasonsByVerdict, tally, type Vote } from "../src/lib/loop/calibration";
import { NEAR_DUPLICATE_BITS, hamming, overlap, simhash } from "../src/lib/loop/integrity";
import { interestMessage } from "../src/lib/loop/messages";
import { MUST_HAVE_TIER, mustHaveFromAssessment, mustHaveFromSignals } from "../src/lib/loop/must-have";
import { furthest, isSilver, silverReason } from "../src/lib/loop/past";

const must = [
  { id: "k", name: "Kafka" },
  { id: "g", name: "Go" },
];

test("must-haves: evidence against is missing, silence is only unconfirmed, overrides win", () => {
  const item = (criterionId: string, result: string, overrideResult: string | null = null) => ({ criterionId, criterionName: "", result, overrideResult });
  assert.equal(mustHaveFromAssessment(must, [item("k", "supported"), item("g", "supported")]).state, "met");
  assert.deepEqual(mustHaveFromAssessment(must, [item("k", "supported"), item("g", "not_stated")]).unconfirmed, ["Go"]);
  const miss = mustHaveFromAssessment(must, [item("k", "confirmed_absent"), item("g", "supported")]);
  assert.equal(miss.state, "missing");
  assert.deepEqual(miss.missing, ["Kafka"]);
  assert.equal(mustHaveFromAssessment(must, [item("k", "confirmed_absent", "supported"), item("g", "supported")]).state, "met");
  assert.equal(mustHaveFromAssessment(must, null).state, "unconfirmed");
  assert.equal(mustHaveFromAssessment([], null).state, "none");
  assert.ok(MUST_HAVE_TIER.met < MUST_HAVE_TIER.unconfirmed && MUST_HAVE_TIER.unconfirmed < MUST_HAVE_TIER.missing);
});

test("must-haves on Discover results: aliases count, public profiles never prove absence", () => {
  const skills = [{ name: "Kafka", aliases: "event streaming, Pulsar" }];
  assert.equal(mustHaveFromSignals(skills, [{ term: "pulsar", matched: true }]).state, "met");
  const r = mustHaveFromSignals(skills, [{ term: "Kafka", matched: false }]);
  assert.equal(r.state, "unconfirmed");
  assert.deepEqual(r.missing, []);
});

const cv = (extra: string) =>
  `Senior backend engineer with eight years building payment systems in Go and Java. Led the settlement service migration to Kafka at Helio, handling forty thousand events a second. Designed PostgreSQL schemas, tuned slow queries with partial indexes, and ran on-call for the payments platform. Mentored four engineers and introduced contract testing across twelve services. ${extra}`;

test("near-identical CVs are close in simhash; different CVs are not", () => {
  const a = simhash(cv("Based in Bengaluru."))!;
  const b = simhash(cv("Based in Pune."))!;
  const c = simhash("Product designer focused on onboarding flows and design systems for consumer fintech apps, running research with users every week, shipping prototypes in Figma, partnering with engineers on accessibility, and writing design guidelines adopted across three product squads and two markets in Europe and India over five years.")!;
  assert.ok(hamming(a, b) <= NEAR_DUPLICATE_BITS, `near copies differ in few bits (${hamming(a, b)})`);
  assert.ok(hamming(a, c) > NEAR_DUPLICATE_BITS * 2, `different CVs differ a lot (${hamming(a, c)})`);
  assert.equal(simhash("too short to compare"), null);
});

test("copied answers overlap strongly; independent answers don't", () => {
  const x = "I left because decisions took months to make and I want to own a problem end to end, ship every week and talk to customers directly about what we build.";
  assert.ok(overlap(x, x.replace("months", "quarters")) > 0.6);
  assert.ok(overlap(x, "My last team was great but I want to work on developer tooling and learn more about distributed databases at a smaller company.") < 0.2);
});

test("interest message uses only what we know and includes the link", () => {
  const m = interestMessage({ candidateName: "Arjun Bose", recruiter: "Priya", company: "Acme", roleTitle: "Backend Engineer", location: "Bengaluru", line: "Your Kafka work caught my eye.", url: "https://x/interest/int_abc" });
  assert.match(m, /^Hi Arjun,/);
  assert.match(m, /Backend Engineer role at Acme \(Bengaluru\)\. Your Kafka work caught my eye\./);
  assert.match(m, /https:\/\/x\/interest\/int_abc/);
  assert.doesNotMatch(interestMessage({ candidateName: "A", recruiter: "P", company: "C", roleTitle: "R", url: "u" }), /undefined|null/);
});

test("past candidates: reached the hiring team or shortlisted, never the hired", () => {
  const at = new Date("2026-03-15T00:00:00Z");
  assert.equal(furthest(["new", "interview", "rejected"]), "interview");
  assert.equal(isSilver({ roleTitle: "Data Eng", stagesReached: ["new", "interview", "rejected"], decision: null, kitDecision: null, at }), true);
  assert.equal(isSilver({ roleTitle: "Data Eng", stagesReached: ["new", "in_review"], decision: null, kitDecision: null, at }), false);
  assert.equal(isSilver({ roleTitle: "Data Eng", stagesReached: ["new"], decision: "advance", kitDecision: null, at }), true);
  assert.equal(isSilver({ roleTitle: "Data Eng", stagesReached: ["interview", "offer", "hired"], decision: "advance", kitDecision: null, at }), false);
  assert.equal(silverReason({ roleTitle: "Data Eng", stagesReached: ["interview"], decision: "advance", kitDecision: "hold", at }), "Reached interview for Data Eng (Mar 2026), shortlisted, team decision: hold");
});

test("calibration: tally, reasons by verdict, and when there's enough to learn", () => {
  const items: { name: string; votes: Vote[] }[] = [
    { name: "A", votes: [{ verdict: "yes", reason: "Owned Kafka", userName: "P" }] },
    { name: "B", votes: [{ verdict: "no", reason: "", userName: "P" }] },
    { name: "C", votes: [{ verdict: "unsure", reason: "", userName: "P" }] },
  ];
  assert.deepEqual(tally(items.flatMap((i) => i.votes)), { yes: 1, no: 1, unsure: 1 });
  assert.deepEqual(reasonsByVerdict(items).yes, [{ name: "A", reason: "Owned Kafka", by: "P" }]);
  assert.equal(readyToLearn(items), true);
  assert.equal(readyToLearn(items.slice(0, 2)), false);
  assert.equal(readyToLearn(items.map((i) => ({ votes: i.votes.map((v) => ({ ...v, reason: "" })) }))), false);
});
