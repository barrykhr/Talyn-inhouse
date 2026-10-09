# Talyn In-house TA

A recruiting workspace for internal talent acquisition teams: roles, structured criteria,
candidates, pipelines, and evidence-based AI-assisted candidate review.

**Phases 1–2.** Roles, criteria, CV/JD extraction and evidence-based assessment (Phase 1);
review queue, provenance, audit and retention, Ideal Candidate Profiles, AI search planning,
authorized sourcing, ranking, recruiter-approved outreach and interview questions (Phase 2).
AI suggests and explains; recruiters review, edit and decide. Nothing is advanced, hidden,
rejected or sent by AI.

**Integrations are built but off.** Email sending (any SMTP service), a sourcing-provider API
and an ATS sync are implemented vendor-neutrally and switch on when their environment variables
are set. Until then Talyn shows a setup state for each (Settings → Integrations). See
[docs/INTEGRATIONS.md](docs/INTEGRATIONS.md) and [docs/ATS_INTEGRATION.md](docs/ATS_INTEGRATION.md).

## Deploy to Vercel

1. **Import the repo** at [vercel.com/new](https://vercel.com/new) and pick this repository
   (choose the branch to deploy). Framework preset: **Next.js** — no other build settings needed.
2. **Add a database.** Add **Prisma Postgres** (offered on the import screen) or **Neon** from
   **Storage**, connected to all environments. Either sets `DATABASE_URL` automatically. Any
   Postgres works: set `DATABASE_URL`, plus `DATABASE_URL_UNPOOLED` if that URL is a pooled one.
3. **Optional — enable AI.** In **Settings → Environment Variables**, add `OPENAI_API_KEY` or
   `ANTHROPIC_API_KEY` (and optionally a model override).
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

## Sign in with Google

1. In [Google Cloud Console](https://console.cloud.google.com/) → **APIs & Services**:
   - **OAuth consent screen** (Google Auth Platform → Branding/Audience): app name "Talyn",
     support email, and choose **External** (any Google account) or **Internal** (your Google
     Workspace only). Scopes needed: `openid`, `email`, `profile` (non-sensitive, no review).
   - **Credentials → Create credentials → OAuth client ID → Web application.**
     Authorized redirect URI: `https://<your-domain>/api/auth/google/callback`
     (add `http://localhost:3000/api/auth/google/callback` for local development).
2. In Vercel → **Settings → Environment Variables**, add `GOOGLE_CLIENT_ID`,
   `GOOGLE_CLIENT_SECRET`, `APP_URL` (e.g. `https://talyn-inhouse.vercel.app`) and optionally
   `GOOGLE_ALLOWED_DOMAINS`. Redeploy.

How it behaves:
- The button appears on sign-in and sign-up only when the client ID and secret are set.
- New Google users name their company to create a workspace (they become its admin).
- If a password account already exists with the same email, Google sign-in links to it and the
  password is removed (password sign-up doesn't verify email ownership; Google does), so that
  account signs in with Google from then on.
- Only verified Google emails are accepted; `GOOGLE_ALLOWED_DOMAINS` restricts which domains.

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
| `OPENAI_API_KEY` | no | Enables AI features using OpenAI. |
| `OPENAI_MODEL` | no | OpenAI model (default `gpt-5.5`). |
| `ANTHROPIC_API_KEY` | no | Enables AI features using Anthropic (Claude). |
| `TALYN_AI_MODEL` | no | Anthropic model (default `claude-opus-5-5`). |
| `AI_PROVIDER` | no | `openai` or `anthropic`. Only needed if both keys are set (Anthropic wins otherwise). |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | no | Enables **Continue with Google**. See "Sign in with Google" below. |
| `GOOGLE_ALLOWED_DOMAINS` | no | Comma-separated email domains allowed to use Google sign-in (e.g. `acme.com`). |
| `CRON_SECRET` | recommended | Protects `/api/cron/*` (retention, outreach sending, ATS sync). Vercel sends it automatically. |
| `SMTP_*`, `OUTREACH_*`, `EMAIL_WEBHOOK_SECRET` | no | Email sending. See [docs/INTEGRATIONS.md](docs/INTEGRATIONS.md). |
| `SOURCING_*` | no | Sourcing provider API. See docs/INTEGRATIONS.md. |
| `ATS_*` | no | ATS sync. See docs/INTEGRATIONS.md. |
| `APP_URL` | recommended | Public URL (e.g. `https://talyn-inhouse.vercel.app`); keeps the Google redirect URI exact. |

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

## Keyboard

- **⌘K / Ctrl+K** — search roles and candidates, or jump anywhere
- **G then R / G then C** — go to roles / candidates
- Tabs support arrow keys; dialogs close with **Esc**

## Manual walkthrough

1. **Sign up** (email/password or Google) — creates your organization and an admin account.
2. **Roles → New role → Upload job description** (PDF/DOCX), or **Enter manually**.
   - Talyn keeps the file, uses its text as the job description, extracts title, department,
     location, employment type, responsibilities, qualifications and experience requirements,
     and proposes criteria. Every item shows its source (JD page · section · quoted text, ✓ if
     found in the document).
   - The **Job description** tab opens with a review form: tick, correct or untick each detail,
     then **Save reviewed details**. Nothing is applied before that.
3. **Criteria tab** — proposed criteria wait under *Awaiting your review* with the JD excerpt and
   page/section they came from. Edit wording, set essential/preferred and priority, then
   **Approve** or **Reject**. You can also **+ Add criterion** yourself. Any change to approved
   criteria bumps the role's criteria version.
4. **Candidates → New candidate → Upload CV** (PDF/DOCX), or **Enter manually**.
   - Unreadable files (password-protected, scanned/no text, damaged, old `.doc`, unsupported)
     are explained and nothing is created; you can switch to manual entry.
   - Contact details are read locally (never sent to AI). Name, location, current title/company,
     work history, education, skills and certifications are extracted with sources.
   - Review on the candidate page: correct or untick anything, then **Save reviewed profile**.
     The Profile card labels each field *From CV*, *From CV, corrected by recruiter*, or
     *Entered by recruiter*.
5. **Assess with AI** (or **Keyword check**) on the candidate's role — or tick *Also map the CV to
   this role's criteria* when uploading, which runs it as the final upload stage. Evidence is on
   the left; the score, recommendation and your decision stay in the right-hand panel (a
   *Review & decide* drawer on small screens). Click any citation to open the CV at that passage. Per criterion: *Supported,
   Partially supported, Inferred, Conflicting evidence* or *Not stated*, with verbatim evidence and
   its location (✓ found / ⚠ not found — unverifiable "supported" claims are downgraded),
   explanation, missing information and confidence. **Correct this** overrides a result with a
   reason.
6. **Score** — *Criteria alignment* (0–100) and *Evidence coverage* shown separately; open
   **How this is calculated** for weights and per-criterion points. Withheld when evidence is too
   incomplete. Not a measure of candidate quality or likelihood of hire.
7. **Recommendation** (after the score) — AI suggests *Advance to the next human review*, *Gather
   more information*, or *Does not currently show enough evidence for the approved criteria*, with
   rationale and questions. **Accept**, **Edit rationale** or **Override** it, then record your
   **Recruiter decision**. Pipeline stages only ever move when you change them.
8. Editing approved criteria flags existing assessments as **out of date** (criteria vN → vM);
   re-run to update. Each assessment records the CV file, parser version, criteria version,
   engine version and model.
9. **Role → Export CSV** includes stage, decision, criteria version, score, coverage, AI
   recommendation, its review status and the final recommendation.

## Role workspace: Applicants · Discover · Shortlist

Each role has three people tabs, kept deliberately separate:

- **Applicants** (inbound) — people who applied: added manually, from a CV, by CSV import or from
  the ATS. List with search (name, title, company, or any skill in the CV), stage and review-status
  filters; Board and Ranked views. Each row shows evidence *found / uncertain / missing* from the
  latest assessment (not a score) and **Shortlist · Hold · Reject**. Reject asks for a job-related
  reason. None of these moves the pipeline stage, and none is ever chosen by AI.
- **Discover** (outbound) — people a recruiter finds. Enter a query plus skills, location,
  seniority, titles and adjacent titles; pick a source; results are cards with matched quotes,
  source name and link, date found, and what is *not established by the source*. **View
  evidence**, **Save to role** (marks the person *Discovered* and adds them to the Shortlist —
  never to Applicants), **Dismiss**, and **Draft message** (email or WhatsApp text from matched
  evidence; draft only, nothing is sent from Discover).
- **Shortlist** — everyone the recruiter wants to progress, from both workflows, each labeled
  *Applied* or *Discovered*.

The candidate page is shared, with separate cards for role-fit evidence, **How they came to this
role**, **Contact & permission** (applied vs. not established vs. opted out), and **Your decision**.

**Sample data.** While no live sourcing provider is connected, Discover offers *Sample data
(fictional)*: a fixed list of fictional profiles, labeled as samples everywhere (results, cards,
candidate page, CSV export) and never presented as a live search. Remove them with **Remove sample
data** on the Discover tab. *Talyn rediscovery* (your own existing candidates) is a real source.

## Phase 2 walkthrough

1. **Queue** (`G` then `Q`) — everything waiting on a person: proposed criteria, CV reviews,
   assessments to review, info requests, sourcing results, outreach to approve/send, replies.
2. **Role → Discover → Ideal Candidate Profile** — generate from the JD and approved criteria
   (or start blank). Every item shows its source; clarification questions are listed. Edit, then
   **Approve**. Changes create a new version.
3. **Search strategy** — plan from the approved ICP: titles, skills, locations, exclusions, a
   Boolean string and a criterion mapping. Edit and save (versioned). **Run search** uses
   connected sources only: *Talyn rediscovery* (candidates already in your workspace), and the
   external provider once `SOURCING_*` is set. **Import an authorized export** (CSV) works now.
4. **Results** — each profile shows matched signals with quotes, staleness and duplicates. Save
   to role, mark not relevant (with feedback) or leave for later. Nothing is auto-rejected.
5. **Role → Ranked list** — *Role fit* (criteria alignment) and *Stage readiness* are separate
   sorts; low-confidence/unassessed candidates are shown as unranked. Recruiters can set a
   priority with a note; it never changes the stage.
6. **Candidate → Outreach** — draft a sequence grounded only in the profile and role facts
   (shown beside the draft). Approve each step, then **Activate**. Pause/stop any time. Without
   an email provider, send from your own mailbox and **Record as sent**; replies, opt-outs and
   bounces are recorded by the recruiter (reply/opt-out stop the sequence; opt-out blocks future
   outreach). With SMTP configured, Talyn sends due approved messages itself, with an unsubscribe
   link, and records provider events from the email webhook.
7. **Questions** — core questions per role (Criteria tab) and follow-ups per candidate
   (Assessment tab), each linked to a criterion. Talyn never sends them.
8. **Settings** — retention period and **Apply now**, audit log, **Integrations** (status of
   each variable, test email, send now, ATS link/sync/history), and **Success measures**.
9. **ATS** (once configured) — link the workspace, then on each role's **ATS** tab link the ATS
   job and map stages. Differences the sync won't overwrite appear in the queue.

## Project layout

```
prisma/                     Data model (all business tables carry orgId) and migrations
src/lib/                    Server utilities: auth, db, resume extraction, AI, evidence
src/server/                 Server actions (mutations) + org-scoped ownership checks
src/app/(auth)/             Login / signup
src/app/(app)/              Roles, candidates, import/export, settings
src/app/api/                Authenticated resume download and CSV exports
src/components/             UI primitives and shared widgets
src/lib/sourcing/           Search filters, Boolean builder, sourcing connectors
src/lib/outreach/           Email provider interface, grounded personalization facts
src/lib/ats/                ATS connector (REST contract) and sync engine — off until configured
docs/ARCHITECTURE.md        Decisions, data model, security and AI design
docs/INTEGRATIONS.md        Email, sourcing and ATS setup and API contracts
docs/ATS_INTEGRATION.md     ATS field ownership, duplicates, conflicts, sync failures
```
