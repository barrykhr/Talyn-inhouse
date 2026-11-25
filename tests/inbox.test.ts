import assert from "node:assert/strict";
import { test } from "node:test";
import { coveredByReplies, fingerprint, hiddenKeys } from "../src/lib/inbox-core";

test("fingerprint is stable and changes with content", () => {
  assert.equal(fingerprint("3 new applicants"), fingerprint("3 new applicants"));
  assert.notEqual(fingerprint("3 new applicants"), fingerprint("4 new applicants"));
  assert.match(fingerprint(""), /^[0-9a-z]+$/);
});

test("evidence follow-ups already shown under replies are skipped", () => {
  assert.equal(coveredByReplies("Waiting on assistant draft"), true);
  assert.equal(coveredByReplies("Candidate replied 2h ago"), true);
  assert.equal(coveredByReplies("Missing: notice period"), false);
  assert.equal(coveredByReplies(null), false);
});

test("done hides; snooze hides only until its time", () => {
  const now = Date.parse("2026-11-25T12:00:00Z");
  const hidden = hiddenKeys(
    [
      { itemKey: "a", status: "done", until: null },
      { itemKey: "b", status: "snoozed", until: new Date(now + 3600_000) },
      { itemKey: "c", status: "snoozed", until: new Date(now - 1) },
      { itemKey: "d", status: "seen", until: null },
    ],
    now,
  );
  assert.deepEqual([...hidden].sort(), ["a", "b"]);
});
