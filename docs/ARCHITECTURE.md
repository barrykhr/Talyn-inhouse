# Architecture — Talyn In-house TA (Phases 1–2)

## Stack and tradeoffs

| Concern | Choice | Why / tradeoff |
| --- | --- | --- |
| App | Next.js 15 (App Router), React 19, TypeScript | One deployable for UI and server. Server components + server actions keep data access on the server. Tradeoff: framework coupling. |
| Data | Prisma 6 + Postgres (Neon on Vercel; Docker locally) | Typed queries and versioned migrations (`prisma/migrations`), applied on every Vercel deploy. Enum-like fields are strings; allowed values live in `src/lib/domain.ts` and are validated with zod. |
| Auth | Built-in email/password, DB sessions | No third-party credentials needed to run. scrypt password hashes; random 256-bit session tokens stored only as SHA-256 hashes; httpOnly, SameSite=Lax cookies. Swap for SSO (SAML/OIDC) later. |
| AI | Pluggable provider: OpenAI (Responses API) or Anthropic, both via official SDKs with structured outputs (zod schemas) | Typed, validated JSON instead of free text; same prompts and verification for both. Optional — the app runs fully without a key. OpenAI calls use `store: false`; Anthropic calls enable server-side refusal fallback. |
| Files | Original resumes stored as bytes in Postgres (`ResumeFile`) | Works on serverless hosting with no extra service or credentials, private by default, deleted with the resume via cascade. Fine at Phase 1 scale (≤4 MB files); move to a private object store (S3/GCS/R2) if volume grows. |
| Hosting | Vercel | Serverless functions: request bodies ≤4.5 MB (uploads capped at 4 MB, CSV import batched), AI pages set `maxDuration = 300`. |
| UI | Tailwind v4 + small in-house primitives | Distinct Talyn look without a heavy component kit. |

## Tenancy and access control

- Every business table has `orgId`. Sessions carry `orgId`; membership is re-checked per request.
- All reads go through `requireAuth()` and filter by `auth.orgId`. Lookups by id go through
  `src/server/scope.ts` (`ownRole`, `ownCandidate`, …), which query `{ id, orgId }` so another
  org's record behaves exactly like a missing one (404).
- Child writes (criteria, applications, notes, assessments) verify the parent belongs to the org first.
- Middleware only bounces cookie-less requests; it is not the security boundary.
- Resume files are served by `/api/resumes/[id]`, which checks session + org, sets
  `Cache-Control: private, no-store`, `nosniff` and a sandbox CSP.
- CSV exports neutralize spreadsheet formula injection.

## Data model (summary)

`Organization` ← `Membership` → `User`; `Session`.
`Role` → `Criterion` (structured: name, description, essential/preferred, priority, origin,
original wording, edited flag, JD source excerpt, rationale, approval state).
`Candidate` → `Resume` (per-page extracted text) → `ResumeFile` (original upload, optional); `Note`.
`Application` (candidate ↔ role, stage, recruiter decision) → `StageEvent` (audit),
`Assessment` (generator, model, criteria snapshot, review state) → `AssessmentItem`
(result, evidence JSON, explanation, missing info, confidence, recruiter override).

## AI design

- **Criteria proposal**: the model returns criteria with an exact JD excerpt and rationale. The
  excerpt is kept only if it is actually in the JD. Proposals are `proposed` and unused until a
  recruiter approves them. Recruiter edits are tracked (`edited`, original wording kept).
- **Assessment**: only approved criteria, resume text and candidate-provided information are
  sent (emails/phone numbers redacted; no name fields, contact fields or recruiter notes). The
  prompt forbids protected characteristics and proxies, treats missing information as unknown,
  ignores instructions embedded in candidate material, and asks for no overall score.
- **Verification**: every quote is located in the source (case/whitespace-insensitive) to attach
  page + section and a verified flag. A "supported" result with no verifiable quote is
  downgraded to "inferred / low confidence" with an explicit note.
- **Summary**: counts per importance × result, overrides applied. No weighted score.
- **Staleness**: assessments snapshot the approved criteria (`id`, `updatedAt`); if criteria change
  the assessment is flagged outdated.
- **No autonomy**: no code path changes a stage, decision or visibility based on AI output.

## Document upload and extraction

- `src/lib/documents.ts` parses PDF/DOCX (TXT for pasted/legacy flows) from magic bytes and
  reports specific failures: password-protected, damaged, scanned (no selectable text), legacy
  `.doc`, unsupported, too large. Nothing is created when parsing fails.
- `src/lib/extraction.ts` turns a parsed JD/CV into `ExtractedField` facts: value, source quote,
  page, section, `verified` (quote found in the document), extractor (`ai:<provider>:<model>/
  jd-extract-v1`, `parser:*-heuristic-v1`, `parser:contact-regex-v1`). AI failures fall back to the
  labeled non-AI parser. CV contact details are always extracted locally and redacted before any
  AI call.
- Facts stay `pending` until a recruiter reviews them; review marks each `accepted`, `edited`
  (with the corrected value) or `rejected`, and only then writes to the role/candidate.
  `Candidate.fieldOriginsJson` records whether each profile field is from the CV, CV-corrected,
  or recruiter-entered.
- Original files are stored in Postgres (`JobDescriptionFile`, `ResumeFile`) and served only via
  org-checked routes.

## Scoring and recommendation

- Per-criterion states: supported, partially supported, inferred, conflicting, not stated.
- `src/lib/score.ts` (method `alignment-v1`) is deterministic and computed by Talyn, not the AI:
  essential weight 2, preferred 1; credit supported 1, partial 0.5, inferred 0.5; not stated and
  conflicting are excluded from the score and reduce coverage. Withheld below 60% weighted
  coverage or when fewer than half of essential criteria are assessable; "limited" below 80%.
  The breakdown is stored on the assessment and recomputed live with recruiter corrections.
- The recommendation is a second AI call made after the score, given only per-criterion results
  and the score summary. Guardrail: an "advance" suggestion is changed to "gather more
  information" when the score is withheld. Recruiters accept, edit or override it; the final
  decision and pipeline stage are always separate recruiter actions.
- Traceability: each assessment stores resume id + parser version, criteria snapshot and
  `criteriaVersion`, engine version, provider:model, score JSON and recommendation JSON.

## Client forms and server actions

Forms that call server actions use `useServerForm` + `<ActionForm>` (`src/components/client.tsx`):
no automatic form reset (recruiter input and chosen files survive errors), no React transition
around the action call, and a full page load for post-save navigation. Navigating or refreshing
from inside a transition that awaits a server action intermittently stalled Next's router queue
in testing, dropping navigations.

## Interaction design

Principle: the simplest possible interface over the recruiting intelligence. Recruiter intent →
Talyn uses the current context (role, approved criteria, candidate, documents, assessment,
stage) → proposes → recruiter reviews → recruiter decides → product updates. No chatbot.

- **Truthful staged progress** (`components/staged-progress.tsx`, `components/upload-flows.tsx`):
  JD and CV processing are split into real server steps (`uploadJd` → `extractJdStep` →
  `mapJdCriteriaStep`; `uploadCv` → `extractCvStep` → optional `runAssessment`). A stage
  completes only when its call returns. Active stages show an indeterminate bar, never a
  percentage; slow AI stages show elapsed time after 3s. Failures name the stage, keep finished
  work, and offer retry or manual review.
- **Assessment workspace** (`components/workspace.tsx`): evidence on the left; a persistent,
  sticky right panel with role/stage, score + coverage, AI recommendation (fades when its content
  changes) and the decision. Under `lg` it becomes a bottom bar + native `<dialog>` drawer (focus
  trap, Esc). Advance / Hold / Decline are identical in size and motion, never pre-selected.
- **Source inspection** (`components/source-viewer.tsx`): every verified citation opens the CV
  in a side sheet with the passage highlighted and scrolled into view.
- **Status line** (`components/status-line.tsx`): one calm line per role/candidate stating what
  needs review and the next action.
- **Feedback**: quiet toasts (`components/toast.tsx`, `aria-live`) for meaningful actions; stage
  moves include Undo. Time in stage on pipeline cards is informational, never styled as urgent.
- **Navigation**: ⌘K / Ctrl+K command palette (org-scoped search + jumps), `G R` / `G C`, skip
  link, consistent view-change entrance (`app/(app)/template.tsx`).
- **Motion**: tokens and keyframes in `globals.css`; brief (140–220ms), state-explaining only;
  `prefers-reduced-motion` disables animation and every state remains readable as text.

## Logging

`src/lib/log.ts` logs event names, ids and error classes only. Prisma query logging is disabled.
Never log candidate data, resume text, notes or secrets.

## Phase 2: sourcing, outreach and governance

**Data model additions.** `AuditEvent` (actor, action, entity ids, counts — no candidate
content), `Task` (info requests, reply follow-ups), `Organization.retentionDays`,
`ExtractedField.correctionReason`; `Icp` → `IcpItem` (category, text, origin, JD quote,
verified flag); `SearchStrategy` (versioned filters + Boolean + criterion mapping) →
`SearchRun` (connector, status incl. `setup_required`, counts) → `SourcedProfile` (signals with
quotes, staleness, duplicate link, review state, feedback); `Application.priority*`;
`Candidate.contactOptOut`, `Candidate/Application/Role.atsExternalId`; `AtsSyncRun`, `AtsConflict`,
`AtsStageMap`, `AtsOutbox`; `OutreachTemplate`, `OutreachSequence` → `OutreachMessage`
(approval state, due date, sent-via) and `OutreachEvent` (`providerConfirmed` flag); `Question`
(core per role / follow-up per application, criterion link, status).

**Integrations.** Built in, vendor-neutral, and off until their environment variables are set
(`src/lib/integrations/env.ts` reports set/missing, never values). Contracts: `docs/INTEGRATIONS.md`.
- Sourcing (`src/lib/sourcing/connectors.ts`): `talynRediscovery` (the org's own candidates,
  quoting matching text, stale >18 months, exclusions set aside); `externalProvider` POSTs the
  saved search to `SOURCING_API_URL` and validates each returned record; and authorized CSV
  import (recruiter names the source and attests the licence). All three produce the same
  reviewable `SourcedProfile`s via `profileFromRecord`. No scraping.
- Email (`src/lib/outreach/`): SMTP via nodemailer (file/URL access disabled). `send.ts` sends due
  approved messages in active sequences, re-checking opt-out/status/email per message, with
  signed unsubscribe links and one-click `List-Unsubscribe`. `outcomes.ts` holds the stop rules
  shared by recruiter entries, `/api/webhooks/email` (bearer secret) and `/api/unsubscribe/[token]`.
  Only provider/candidate events are marked `providerConfirmed`.
- ATS (`src/lib/ats/`): `connector.ts` speaks a REST contract; `sync.ts` pulls incrementally into
  the one linked workspace (`Organization.atsLinkedAt`), writes a field only when Talyn's value is
  empty or ATS-set, otherwise records `AtsConflict`; per-role `AtsStageMap`; recruiter stage
  changes go through `AtsOutbox` (ordered, backoff, 5 attempts); runs in `AtsSyncRun`.
- Crons (`vercel.json`, daily, `CRON_SECRET`): retention, outreach, ATS. Each no-ops when off.

**AI.** ICP generation, search planning, outreach drafts, core and follow-up questions use the
same structured-output path as Phase 1. Quotes are kept only when found verbatim in the source
(JD or CV); otherwise the item is downgraded to *inferred*. Outreach drafts receive only an
explicit fact list (`personalizationFacts`) and never contact details; templates are scrubbed of
candidate values before saving.

**Safety rules in code.** Activation requires an email on file, no opt-out, and every step
approved; editing an approved step resets it to draft. Reply or opt-out stops the sequence (and
opt-out blocks new sequences); bounce pauses it. Ranking and sourcing never change stage,
decision or visibility. Tasks resolve without recording a decision.

**Retention and deletion.** Daily `/api/cron/retention` (Bearer `CRON_SECRET`) deletes
candidates with no activity beyond the org's retention period, including resumes, files,
assessments, outreach and Talyn-sourced profiles; audit events keep ids only. Candidate and
organization deletion cascade through the same tables.

**Measures.** `src/lib/measures.ts` computes success measures from recorded data (e.g. ICP-to-
shortlist time, save/contact/duplicate rates per source, match correction rate, unranked rate,
outreach edit/approval/reply/bounce/opt-out rates, task completion).
Below 5 data points a measure reads "Not enough data". These describe usage, not fairness or
predictive validity.

## Role workspace (Applicants · Discover · Shortlist)

- `Application.origin` is `applied` or `discovered` (+ `originDetail`, `sourcedProfileId`). It is set
  once when the application is created (`attach()` in `src/server/pipeline.ts`) and never changes,
  so applicants and discovered people are never merged; saving a Discover result for someone who
  already applied keeps their *Applied* record.
- Shortlist / Hold / Reject reuse the recruiter decision (`advance` / `hold` / `decline`, plus a
  required `decisionReason` for reject). The Shortlist tab is `decision = advance` across both
  origins. Review status (`src/lib/review-status.ts`) is derived from recruiter actions only.
- Evidence tiers (`EVIDENCE_TIER` in `domain.ts`): supported → found; partial / inferred /
  conflicting → uncertain; not stated → missing. Lists show counts, not a score.
- Discover search (`discoverSearch`) saves each query as a `SearchStrategy` version (ICP optional)
  and runs one connector. `sample` is a connector over fixed fictional profiles
  (`src/lib/sourcing/sample-profiles.ts`), enabled only when no live provider is configured;
  saved samples are `Candidate.isSample`. Message drafts (`draftDiscoverMessage`) return text
  only — no persistence, no sending, no contact lookup.
- Not built (out of scope): Signals, monitoring, availability or "ready to switch" predictions,
  and new automated outreach.

## Discover workflow

- `DiscoveryBrief` (one per role): role name, alternative titles, required/preferred skills,
  min/max years, location, work arrangement, exclusions, Boolean query (+ `booleanEdited`,
  `booleanFieldsKey` to flag a stale hand-edited query) and per-field provenance
  (`from_jd` with verified quote / `inferred` / `not_stated` / `edited` / `manual`). Suggested by
  `src/lib/discovery/extract.ts` (AI with quote verification, or a no-AI parser); Boolean built by
  the pure `buildBoolean` in `src/lib/discovery/brief.ts` (also used live in the browser).
- `saveBriefAndSearch` saves the reviewed fields, creates a `SearchStrategy` version and runs each
  selected connector independently. Results are merged across sources (`src/lib/sourcing/merge.ts`,
  strong identifiers or name+company only) into `SourcedProfile` rows with `sourcesJson` (every
  source link + retrieval date). `SearchRun.sourcesJson` records per-source ok/error/setup status;
  `isDemo` marks sample-data runs. Failed sources are reported, never back-filled.
- Experience is evidence, not a filter: `experienceSignal` uses dated experience entries or a
  stated "N years of experience"; otherwise "not established".
- Outreach: `OutreachSequence.channel` (email | whatsapp). `draftSequence` drafts a first message
  + 2–3 follow-ups from `personalizationFacts` (recruiter-confirmed facts and the quoted Discover
  evidence). `activateSequence` is the send approval and is gated per channel; with a provider
  connected the first message is sent immediately (`sendDueMessages`), follow-ups by the cron.
  `Candidate.whatsappPermission*` is a recorded, channel-specific opt-in; `Application.interest*`
  is what the candidate said (recruiter-recorded or "declined" from an outcome) — kept apart from
  role fit. Replies (webhooks or recruiter), declines, opt-outs and pauses stop follow-ups.

## Interviews (Phase 3, first slice)

- `InterviewKit` (one per application) → `InterviewCompetency` (from approved criteria; anchors
  JSON; origin + anchorsOrigin) → `InterviewQuestion` (origin ai | template | core_question |
  recruiter, `edited`); `InterviewStage` (purpose, competency ids, manually entered schedule) →
  `InterviewAssignment` (one interviewer on one stage + their scorecard: entries
  `{ competencyId, rating 1–4 | null, notAssessed, evidence }`, question notes, notes, draft /
  submitted with timestamps); `DebriefComment`. The team decision (`decision`, rationale, who,
  when) lives on the kit and is separate from `Application.decision` and the stage.
- Access (`src/lib/interviews/access.ts`) layers on the existing model where every member sees
  roles and candidates: drafts are visible only to their author; submitted feedback is hidden from
  an assigned interviewer until they submit; the decision needs admin, hiring manager, the plan
  owner or the plan's named hiring manager. `Membership.role` gains `hiring_manager`; `Invite`
  holds hashed one-time join links.
- Kit drafting (`generateInterviewKitWithAi`) receives only the approved criteria and ignores any
  output for criteria it wasn't given; without AI, template questions and anchors are used.
- Debrief "agreement" describes the spread of ratings per competency only; nothing is averaged
  into a verdict. No recording, transcription, analytics or trait inference exists.

## Interview scheduling (Google Calendar)

- `CalendarConnection` (per user + org): Google account email, granted scopes, AES-256-GCM sealed
  access/refresh tokens (`src/lib/secretbox.ts`), expiry, status (connected / permission_required /
  revoked / error). OAuth: `/api/calendar/connect` → Google (PKCE, state cookie, offline access,
  narrow scopes) → `/api/calendar/callback`. `src/lib/calendar/google.ts` refreshes tokens, maps
  401/403/404/409/429/timeouts to recruiter-facing errors, and marks revoked connections.
- `InterviewScheduling` (per stage): inputs and hand-entered windows (interviewers without a
  calendar, candidate). `src/lib/calendar/availability.ts` resolves each interviewer to own calendar
  → shared calendar → manual windows → unknown; `findSlots` (`src/lib/calendar/time.ts`, pure,
  Intl-based time zones) never treats unknown as free.
- `InterviewEvent`: live (Google event id, htmlLink, Meet URL/status, attendees + responses) or demo
  (simulated). `requestKey` is unique and also seeds the Google event id, so retries can't
  duplicate. Live reschedule/cancel run with the organizer's own authorization.
- Scheduling status lives on the stage and event; it is never mixed into scorecards or decisions.

## Extensibility (later phases, not implemented)

- Interview recording/intelligence, a hiring-manager portal and advanced analytics are out of
  scope; interview evidence would attach to `Application` as new evidence sources.
- Auth is isolated behind `src/lib/auth.ts`; resume bytes behind the `ResumeFile` model and `/api/resumes/[id]`.
