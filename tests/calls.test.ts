import assert from "node:assert/strict";
import { test } from "node:test";
import {
  NotetakerPayload,
  candidateCounts,
  companyKey,
  essentialCoverageScore,
  guessSpeakers,
  locateQuote,
  managerProfiles,
  managerSummary,
  passagesOf,
  questionAlignmentScore,
  segmentsFromPayload,
  speakersIn,
  stageOf,
  type ProfileCall,
} from "../src/lib/calls/core";

const segs = [
  { startMs: 0, endMs: 4000, speaker: "Priya Shah", text: "Tell me about the payments migration you led." },
  { startMs: 4000, endMs: 15000, speaker: "Arjun Bose", text: "I led the move from the monolith to Kafka, about 40k events a second." },
  { startMs: 15000, endMs: 18000, speaker: "Priya Shah", text: "How old are your kids?" },
];

test("question alignment counts on as 1, partly as ½, and leaves logistics out", () => {
  assert.equal(questionAlignmentScore([{ alignment: "on_jd" }, { alignment: "partly" }, { alignment: "off_jd" }, { alignment: "risky" }]), 38);
  assert.equal(questionAlignmentScore([{ alignment: "on_jd" }, { alignment: "off_jd", kind: "logistics" }]), 100);
  assert.equal(questionAlignmentScore([]), null);
});

test("essential coverage ignores preferred criteria", () => {
  assert.equal(essentialCoverageScore([{ essential: true, asked: true }, { essential: true, asked: false }, { essential: false, asked: false }]), 50);
  assert.equal(essentialCoverageScore([{ essential: false, asked: true }]), null);
});

test("candidate counts only essential criteria", () => {
  const c = candidateCounts([
    { status: "aligned", essential: true },
    { status: "not_discussed", essential: true },
    { status: "aligned", essential: false },
  ]);
  assert.deepEqual(c, { essential: 2, aligned: 1, partly: 0, notAligned: 0, notDiscussed: 1 });
});

test("speakers are guessed from names only, everyone else stays for a person to set", () => {
  const labels = speakersIn(segs).map((s) => s.label);
  assert.deepEqual(labels, ["Priya Shah", "Arjun Bose"]);
  assert.deepEqual(guessSpeakers([...labels, "Speaker 3"], { candidate: "Arjun Bose", interviewer: "Priya" }), [
    { label: "Priya Shah", role: "interviewer" },
    { label: "Arjun Bose", role: "candidate" },
    { label: "Speaker 3", role: "other" },
  ]);
  assert.equal(guessSpeakers(["Arjun Bose"], {}).at(0)?.role, "other");
});

test("a quote is kept only if its words are in the transcript", () => {
  const ps = passagesOf(segs, [{ label: "Arjun Bose", role: "candidate" }]);
  assert.equal(ps.at(1)?.role, "candidate");
  assert.equal(ps.at(0)?.role, "unknown");
  assert.equal(locateQuote("moved from the monolith", ps), null);
  assert.equal(locateQuote("the move from the monolith to Kafka", ps, 1), 2);
  assert.equal(locateQuote("“How old are your kids?”", ps), 3);
  assert.equal(locateQuote("", ps), null);
});

test("company key ignores case, punctuation and legal suffixes", () => {
  assert.equal(companyKey("Acme Payments Pvt. Ltd."), companyKey("acme payments"));
  assert.equal(companyKey("Smith & Co, Inc"), "smith-and");
  assert.equal(companyKey(""), "unnamed");
});

test("headcount bands map to a company stage", () => {
  assert.equal(stageOf("1-50"), "early_startup");
  assert.equal(stageOf("5,001+"), "enterprise");
  assert.equal(stageOf(null), "unknown");
});

test("notetaker payload needs segments or a transcript, and segments are put in order", () => {
  assert.equal(NotetakerPayload.safeParse({ external_id: "m1", title: "Call" }).success, false);
  const p = NotetakerPayload.parse({
    external_id: "m1",
    title: "Call",
    segments: [
      { speaker: "B", start_seconds: 5, text: "second" },
      { speaker: "A", start_seconds: 1.5, end_seconds: 4, text: "first" },
      { speaker: "C", start_seconds: 9, text: "   " },
    ],
  });
  assert.deepEqual(segmentsFromPayload(p), [
    { startMs: 1500, endMs: 4000, speaker: "A", text: "first" },
    { startMs: 5000, endMs: 5000, speaker: "B", text: "second" },
  ]);
  assert.equal(segmentsFromPayload(NotetakerPayload.parse({ external_id: "m2", transcript: "00:01 A: hi" })), null);
});

test("hiring manager profiles are counted per person across calls", () => {
  const base = { roleId: "r1", roleTitle: "Backend Engineer", interviewerRole: "hiring_manager" as const, occurredAt: null, expectations: [] };
  const calls: ProfileCall[] = [
    {
      ...base,
      callId: "c1",
      kind: "interview",
      interviewerName: "Priya Shah",
      questionAlignment: 80,
      essentialCoverage: 50,
      questions: [
        { alignment: "on_jd", kind: "technical", criterionName: "Kafka", question: "Kafka?" },
        { alignment: "risky", kind: "other", criterionName: null, question: "Kids?" },
      ],
      coverage: [
        { criterionName: "Kafka", essential: true, asked: true },
        { criterionName: "On-call", essential: true, asked: false },
      ],
    },
    {
      ...base,
      callId: "c2",
      kind: "interview",
      interviewerName: "priya shah ",
      questionAlignment: 60,
      essentialCoverage: 50,
      questions: [{ alignment: "on_jd", kind: "technical", criterionName: "Kafka", question: "Scale?" }],
      coverage: [
        { criterionName: "Kafka", essential: true, asked: true },
        { criterionName: "On-call", essential: true, asked: false },
      ],
    },
    { ...base, callId: "c3", kind: "intake", interviewerName: "Priya Shah", questionAlignment: null, essentialCoverage: 50, questions: [], coverage: [], expectations: [{ status: "adds", topic: "Go experience" }] },
    { ...base, callId: "c4", kind: "interview", interviewerName: null, questionAlignment: 10, essentialCoverage: 0, questions: [], coverage: [] },
  ];
  const [p, ...rest] = managerProfiles(calls);
  assert.equal(rest.length, 0, "calls without an interviewer are left out");
  assert.equal(p.calls, 3);
  assert.equal(p.interviews, 2);
  assert.equal(p.questionAlignment, 70);
  assert.deepEqual(p.focus, [{ criterion: "Kafka", times: 2 }]);
  assert.deepEqual(p.skipped, [{ criterion: "On-call", skippedIn: 2, of: 2 }]);
  assert.equal(p.risky.length, 1);
  assert.deepEqual(p.drift, [{ topic: "Go experience", status: "adds", callId: "c3" }]);
  const lines = managerSummary(p);
  assert.ok(lines.some((l) => l.includes("70%")));
  assert.ok(lines.some((l) => l.includes("On-call (2 of 2)")));
  const single = managerProfiles(calls.slice(0, 1)).at(0)!;
  assert.ok(managerSummary(single).some((l) => l === "In their interview they didn't ask about On-call."));
  assert.ok(!managerSummary(single).some((l) => l.includes("often")));
});
