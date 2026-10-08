# Architecture — Talyn In-house TA (Phase 1)

## Stack and tradeoffs

| Concern | Choice | Why / tradeoff |
| --- | --- | --- |
| App | Next.js 15 (App Router), React 19, TypeScript | One deployable for UI and server. Server components + server actions keep data access on the server. Tradeoff: framework coupling. |
| Data | Prisma 6 + Postgres (Neon on Vercel; Docker locally) | Typed queries and versioned migrations (`prisma/migrations`), applied on every Vercel deploy. Enum-like fields are strings; allowed values live in `src/lib/domain.ts` and are validated with zod. |
| Auth | Built-in email/password, DB sessions | No third-party credentials needed to run. scrypt password hashes; random 256-bit session tokens stored only as SHA-256 hashes; httpOnly, SameSite=Lax cookies. Swap for SSO (SAML/OIDC) later. |
| AI | Anthropic SDK, structured outputs (zod schemas) | Typed, validated JSON instead of free text. Optional — the app runs fully without a key. Server-side refusal fallback is enabled. |
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

## Logging

`src/lib/log.ts` logs event names, ids and error classes only. Prisma query logging is disabled.
Never log candidate data, resume text, notes or secrets.

## Extensibility (later phases, not implemented)

- Sourcing/outreach (Phase 5) would add `Candidate.source` values and new modules alongside
  `src/server/`; criteria and assessments are already source-agnostic.
- Interview intelligence would attach to `Application` as new evidence sources
  (`Evidence.source` is a discriminated string).
- Auth is isolated behind `src/lib/auth.ts`; resume bytes behind the `ResumeFile` model and `/api/resumes/[id]`.
