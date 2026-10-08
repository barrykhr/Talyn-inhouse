# ATS integration plan

**Status: no ATS is connected.** No provider has been selected, so Talyn ships only the
connector interface (`src/lib/ats/connector.ts`, `getAtsConnector()` returns `null`) and the
Settings → Integrations card says so. CSV import (candidates) and CSV export (role pipeline)
are the supported paths until an ATS is chosen.

To activate a connector we need: the ATS product, an API credential with read access to
candidates/applications/jobs, and — only if Talyn should push stage changes — write access to
application stages. The connector must implement `AtsConnector` and follow the rules below.

## Field ownership

Each field has one source of truth. A connector declares this in `ownership`.

| Field | Owner | Notes |
| --- | --- | --- |
| Candidate name, email, phone | ATS | Talyn shows the ATS value; local edits are flagged as conflicts, not pushed. |
| Current title / company, location | recruiter_choice | Default ATS; a recruiter-confirmed CV correction in Talyn wins and is shown as a conflict until resolved. |
| Job/requisition (title, department, location) | ATS | Linked to a Talyn role by external id. |
| Role criteria, criteria versions, ICP, search strategies | Talyn | Never written to the ATS. |
| Assessments, evidence, scores, AI recommendations, questions | Talyn | Never written to the ATS. AI output is not ATS data. |
| Pipeline stage | ATS, with recruiter-initiated push | Talyn pushes only a stage change a recruiter made in Talyn (`pushStageChange`). AI never triggers a push. |
| Recruiter decision, notes | Talyn | Optional one-way push of a recruiter note, if the customer asks for it. |
| Outreach history, opt-out | Talyn (opt-out also pushed where the ATS supports it) | An opt-out is never cleared by a sync. |

**Recruiter edits are never silently overwritten.** If a pulled value differs from a value a
recruiter entered or corrected in Talyn, the sync records a conflict instead of writing.

## Duplicates

- Match order: ATS external id → email (case-insensitive) → no automatic match.
- Name-only or name + company similarity is **suggested** as a possible duplicate in the review
  queue; it is never merged automatically.
- A merge is a recruiter action, audited, and keeps both provenance trails.

## Conflicts

- A conflict stores field, Talyn value, ATS value, external id and time (`SyncResult.conflicts`).
- Conflicts appear in the review queue with "Keep Talyn value" / "Use ATS value". The choice is
  audited. Until resolved, the candidate page shows both values, labeled by source.

## Stage mapping

- Mapping is per role (ATS pipelines differ by job). A role cannot sync stage changes until every
  Talyn stage used by that role maps to an ATS stage, or is explicitly marked "not synced".
- Unmapped ATS stages pulled from the ATS are shown as-is and do not move the Talyn stage.

## Sync status and failures

- Each sync records start/end time, created/updated counts, conflicts and errors, shown in
  Settings → Integrations. The last successful sync time is shown on synced records.
- Pull failures leave Talyn data unchanged. Push failures (stage change) leave the Talyn change in
  place, mark it "not synced", and add a queue item; retries use backoff and never reorder changes.
- Credentials are stored as environment secrets, never in the database or logs. Logs contain ids
  and counts only — no candidate data.
- Rate limits and partial failures are reported per record; a failed record never blocks others.

## Out of scope until a provider is chosen

Webhooks, bidirectional real-time sync, attachments (CVs) sync and interview scheduling.
