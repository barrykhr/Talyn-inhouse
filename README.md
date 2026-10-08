# Talyn In-house TA

A recruiting workspace for internal talent acquisition teams: roles, structured criteria,
candidates, pipelines, and evidence-based AI-assisted candidate review.

**Phase 1 scope.** AI suggests and explains; recruiters review, edit and decide. Nothing is
advanced, hidden or rejected by AI.

## Deploy to Vercel

1. **Import the repo** at [vercel.com/new](https://vercel.com/new) and pick this repository
   (choose the branch to deploy). Framework preset: **Next.js** — no other build settings needed.
2. **Add a database.** Add **Prisma Postgres** (offered on the import screen) or **Neon** from
   **Storage**, connected to all environments. Either sets `DATABASE_URL` automatically. Any
   Postgres works: set `DATABASE_URL`, plus `DATABASE_URL_UNPOOLED` if that URL is a pooled one.
3. **Optional — enable AI.** In **Settings → Environment Variables**, add `ANTHROPIC_API_KEY`
   (and optionally `TALYN_AI_MODEL`).
4. **Deploy** (or redeploy after adding variables). The `vercel-build` script runs
   `prisma migrate deploy` to create/upgrade tables, then builds the app.
5. Open the deployment URL and click **Create a workspace**.

Notes for Vercel:
- Resume uploads are limited to **4 MB** (Vercel's request size limit is ~4.5 MB). Original
  files are stored privately in Postgres and served only to members of the owning workspace.
- AI requests can take up to a minute; the role and candidate pages allow up to 300 s.
- Large CSV files are imported in batches automatically.
- Anyone with the URL can create their own (isolated) workspace. To restrict access to your
  team, enable **Deployment Protection** in Vercel project settings.

## Run locally

Requirements: Node.js 20.9+, npm, and Postgres (Docker is easiest).

```bash
docker compose up -d # local Postgres on :5432 (or point .env at any Postgres)
npm install          # also generates the Prisma client
npm run setup        # creates .env from .env.example (if missing) and applies migrations
npm run dev          # http://localhost:3000
```

Open the app, choose **Create a workspace**, and sign up. There is no seed data — the
workspace starts empty.

## Configuration

All configuration is via environment variables (`.env`):

| Variable | Required | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | yes | Postgres connection used by the app. |
| `DATABASE_URL_UNPOOLED` | no | Direct connection for migrations when `DATABASE_URL` is pooled (set automatically by Neon). |
| `ANTHROPIC_API_KEY` | no | Enables AI-proposed criteria and AI assessments (Claude). |
| `TALYN_AI_MODEL` | no | Override the model (default `claude-opus-5-5`). |

### Without an AI key

The full workflow still runs. AI buttons are disabled with an explanation, and two
**clearly labeled non-AI helpers** are available:

- **Extract bullet points** — turns bullets under requirement headings in the job description
  into *proposed* criteria (essential vs. preferred is inferred from headings such as
  "Requirements" / "Nice to have"). They still require approval.
- **Keyword check (no AI)** — finds resume lines that contain criterion keywords. Matches are
  recorded as *inferred, low confidence* (never "supported"), with the matched lines as evidence.

No output is ever presented as coming from a model unless it did.

## Scripts

| Script | Description |
| --- | --- |
| `npm run dev` | Development server |
| `npm run build` / `npm start` | Production build / server |
| `npm run typecheck` | TypeScript check |
| `npm run db:migrate` | Create a new migration after changing `prisma/schema.prisma` (development) |
| `npm run db:deploy` | Apply pending migrations (what Vercel runs on deploy) |
| `npm run db:studio` | Browse the database |

## Manual walkthrough

1. **Sign up** — creates your organization and an admin account.
2. **Roles → New role** — enter title, department, location, employment type, status, and paste
   the job description (bulleted requirements work best).
3. **Criteria tab** — click **Propose with AI** (or **Extract bullet points** without a key).
   Proposals appear under *Awaiting your review* with the JD excerpt they came from and a
   rationale ("Why this criterion?"). Edit wording, switch essential/preferred, set a priority,
   then **Approve** or **Reject**. You can also **+ Add criterion** yourself (active immediately).
4. **Candidates → New candidate** (or **Import & export** for a CSV) — add profile, contact
   details, candidate-provided information, a resume (PDF/DOCX/TXT up to 4 MB, or pasted text), a private
   note, and optionally attach to a role.
5. **Candidate profile** — select the role chip, then **Assess with AI** (or **Keyword check**).
   For each approved criterion you see: *Supported / Inferred / Not stated*, verbatim evidence
   with its location (resume page and section, or candidate-provided info), a ✓ if the quote was
   found in the source, an explanation, missing information, and confidence. Evidence is
   highlighted in the resume panel on the right.
6. **Correct this** on any criterion to override the result with a reason; corrections are shown
   alongside the original. **Mark as reviewed** when done.
7. **Recruiter decision** — Advance / Hold / Decline with a job-related rationale (required for
   Decline). Then move the **Stage** yourself; every move is logged in *Stage history*.
8. **Role → Pipeline** — board of all eight stages with assessment summaries, review state and
   decisions. **Export CSV** exports the pipeline with per-criterion results.
9. **Import & export** — export all candidates or roles & criteria as CSV.
10. **Delete** — candidates (removes resume files, notes, assessments), roles, individual resumes,
    or the whole workspace from **Settings**.

## Project layout

```
prisma/                     Data model (all business tables carry orgId) and migrations
src/lib/                    Server utilities: auth, db, resume extraction, AI, evidence
src/server/                 Server actions (mutations) + org-scoped ownership checks
src/app/(auth)/             Login / signup
src/app/(app)/              Roles, candidates, import/export, settings
src/app/api/                Authenticated resume download and CSV exports
src/components/             UI primitives and shared widgets
docs/ARCHITECTURE.md        Decisions, data model, security and AI design
```
