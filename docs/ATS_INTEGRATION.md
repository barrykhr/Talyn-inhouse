# ATS integration plan

**Status: built, not connected.** No ATS has been selected. The sync engine
(`src/lib/ats/sync.ts`) and a vendor-neutral REST connector (`src/lib/ats/connector.ts`) are in
place and stay off until `ATS_NAME`, `ATS_API_URL` and `ATS_API_KEY` are set and an admin links
the workspace. The REST contract and setup are in [INTEGRATIONS.md](INTEGRATIONS.md). CSV import
(candidates) and CSV export (role pipeline) remain available.

To connect we need: the ATS product, an API credential with read access to
candidates/applications/jobs, and — only if Talyn should push stage changes — write access to
application stages. Either expose the Talyn ATS contract through a small adapter, or add a
dedicated `AtsConnector` for that ATS. Either way the rules below apply (they are implemented in
the sync engine, not the connector).

## Field ownership

Each field has a usual owner (`FIELD_OWNERSHIP` in `src/lib/ats/connector.ts`). Ownership labels the
conflict choice; it never lets sync overwrite a value a person entered or confirmed in Talyn.

| Field | Owner | Notes |
| --- | --- | --- |
| Candidate name, email, phone | ATS | Filled from the ATS when empty in Talyn or last set by the ATS; otherwise a conflict. Not pushed. |
| Current title / company, location, LinkedIn URL | recruiter_choice | Same write rule; differences are conflicts for the recruiter to choose. |
| Job/requisition | ATS | An admin links a Talyn role to an ATS job (role → ATS tab). Role details are not overwritten. |
| Role criteria, criteria versions, ICP, search strategies | Talyn | Never written to the ATS. |
| Assessments, evidence, scores, AI recommendations, questions | Talyn | Never written to the ATS. AI output is not ATS data. |
| Pipeline stage | Shared via mapping | Recruiter stage changes in Talyn are pushed (if `ATS_PUSH_STAGES=true`); mapped ATS stage changes move the Talyn stage on sync. AI never triggers either. |
| Recruiter decision, notes | Talyn | Not pushed. |
| Outreach history, opt-out | Talyn | Not pushed. An opt-out is never cleared by a sync. |

**Recruiter edits are never silently overwritten.** If a pulled value differs from a value a
recruiter entered or corrected in Talyn, the sync records a conflict instead of writing.

## Duplicates

- Match order: ATS external id → email (case-insensitive) → no automatic match.
- No match by name: the ATS record becomes a new Talyn candidate labeled *From ATS*. Name-based
  duplicate suggestions and a merge action are not built yet (see limitations below); nothing is
  ever merged automatically.
- Only one Talyn workspace can be linked to an ATS, so the same ATS candidate is never imported
  into two workspaces.

## Conflicts

- A field is written by sync only when Talyn's value is empty or was last set by the ATS. Any
  other difference is stored as an `AtsConflict` (field, Talyn value, ATS value, external id,
  time). Empty ATS values never erase Talyn data.
- Conflicts appear in the review queue (*ATS differences*) and on the candidate page with "Keep
  Talyn value" / "Use ATS value". The choice is audited; a kept Talyn value isn't re-raised for
  the same ATS value. The field-ownership table decides which choice is labeled the usual owner.

## Stage mapping

- Mapping is per role (ATS pipelines differ by job): each Talyn stage maps to one ATS stage or
  *Don't sync*. Unmapped stages are never pushed; pushes for them are recorded as *not synced*.
- ATS stages with no mapping do not move the Talyn stage. A mapped ATS change is not applied while
  a Talyn change for that application is still waiting to be pushed.

## Sync status and failures

- Each sync records start/end time, created/updated/unchanged counts, conflicts and errors
  (`AtsSyncRun`), shown in Settings → Integrations → Sync history. Pulls are incremental from the
  last successful sync.
- Pull failures stop the run, keep everything already in Talyn, and the next run starts again
  from the last successful sync. Records that fail individually are counted and skipped.
- Stage pushes go through an outbox (`AtsOutbox`): in order per application, exponential backoff,
  up to 5 attempts (4xx other than 429 fail immediately). Failures leave the Talyn change in
  place, appear in the queue (*Stage changes not in the ATS*) and Settings with Retry / Dismiss.
  Unmapped stages are recorded as *not synced* so gaps are visible.
- Credentials are stored as environment secrets, never in the database or logs. Logs contain ids
  and counts only — no candidate data.
- A failed record never blocks others. Push retries treat 429 (rate limit) as temporary.

## Not built yet

Name-based duplicate suggestions and merging, ATS webhooks (sync is scheduled or on demand),
CV/attachment sync, pushing notes/decisions/opt-outs, and interview scheduling.
