# Architecture — Talyn In-house TA (Phase 1)

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

## Extensibility (later phases, not implemented)

- Sourcing/outreach (Phase 5) would add `Candidate.source` values and new modules alongside
  `src/server/`; criteria and assessments are already source-agnostic.
- Interview intelligence would attach to `Application` as new evidence sources
  (`Evidence.source` is a discriminated string).
- Auth is isolated behind `src/lib/auth.ts`; resume bytes behind the `ResumeFile` model and `/api/resumes/[id]`.
