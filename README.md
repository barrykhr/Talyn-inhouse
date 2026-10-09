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
are set. Until then Talyn shows a setup state for each (Integrations (`/integrations`)). See
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
- **G then R / C / D / I / Q** — go to roles / candidates / Discover / interviews / queue
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

## Interviews (Phase 3, first slice)

Structured interviews, independent scorecards and a team debrief. Talyn organizes the evidence;
people decide. No recording, transcription, analytics or behavioral/emotion analysis.

1. **Team** — admins invite teammates in **Settings → Team** (Recruiter, Hiring manager or
   Admin). Talyn creates a one-time link to copy; it doesn't email it.
2. **Plan** — from a role's **Interviews** tab (shortlisted candidates) or a candidate's
   **Interviews** tab, **Create interview plan**. The kit is built only from the role's approved
   criteria: one competency per criterion, the role's approved core questions, plus AI-drafted
   (labeled) or template questions with follow-ups and interviewer notes, and behavioral anchors for
   one 4-point scale (Not / Partly / Demonstrated / Strongly demonstrated) plus *Not assessed*.
   Edit, add, reorder or remove competencies and questions; a competency that isn't in the role's
   criteria is labeled as recruiter-added.
3. **Stages & interviewers** — name each stage, its purpose and competencies, assign workspace
   members, and note the date/time/location you booked yourself (labeled as entered manually — no
   calendar is connected and Talyn sends no invites). **Share with interviewers** opens their
   scorecards under **Interviews**.
4. **Scorecards** — each interviewer rates their stage's competencies against the anchors, writes
   the evidence behind every rating (required), may mark *Not assessed*, and saves a private draft
   or submits. Submitted scorecards are locked (the plan owner or an admin can reopen one; it's
   recorded). An interviewer can't see anyone else's feedback until they've submitted their own.
5. **Debrief** — evidence and ratings per competency with who gave them and when, where
   interviewers agree or disagree (two or more levels apart), what wasn't assessed or is still
   waiting, interviewer notes, and a team discussion. There is no overall score.
5b. **Scheduling** — on each stage, **Schedule interview**: choose interviewers, duration, date
   range, working hours and time zone; enter availability people gave you; **Find available
   times** (Google free/busy for connected calendars, never event details; unknown is never shown as
   free); propose times to the candidate (copy, or the connected email/WhatsApp after you confirm);
   review and **Schedule interview** to create one Google Calendar event with invitations and a new
   Meet link. Reschedule or cancel from the plan. Without Google configured it runs in a labeled
   demo mode. Setup: docs/INTEGRATIONS.md §1a.
6. **Decision** — an admin, a hiring manager, or the plan's owner records **Advance**, **Hold** or
   **Decline** with a rationale. Nothing is pre-selected or recommended, and it doesn't change the
   pipeline stage or the shortlist decision.

## Discover (outbound sourcing)

**Discover** in the left navigation lists every role's search, the sources this workspace can
use, and **New search**.

1. **Set up** — upload a JD (PDF/DOCX) or enter the role details. From a JD, Talyn suggests the
   role name, required and preferred skills, minimum/maximum years, location, work arrangement,
   alternative titles and a Boolean query. Each field is labeled *From JD* (with the quote),
   *Suggested — not found word-for-word*, *Not stated in the JD* (left empty, never guessed) or
   *Edited by you*. The JD stays viewable and replaceable; replacing it re-suggests only the fields
   you haven't edited.
2. **Boolean query** — generated live from the fields (titles OR-ed; required skills and location
   AND-ed; exclusions NOT-ed). Edit it freely; after you edit it, Talyn flags when the fields change
   and offers **Regenerate from fields**. Preferred skills and years are shown as evidence, never
   used to hide people.
3. **Sources** — tick any connected sources (*Talyn rediscovery* is always available; an external
   provider once its credentials are set). **Demo mode** is a separate choice that searches
   fictional sample people; demo runs and cards are labeled everywhere and can't be contacted.
   Each source runs independently: a failing provider is reported with its error and nothing is
   substituted.
4. **Results** — one card per person (merged across sources by Talyn record, email, LinkedIn URL
   or name + company — never name alone), with every source link and retrieval date, a plain
   "why they appeared", skills backed by quotes, and what's uncertain or unavailable. *Role fit
   evidence*, *Expressed interest* and *Permission to contact* are separate fields. **Open
   evidence**, **Save to role**, **Dismiss**.
5. **Outreach** — after saving, open **Outreach**: choose email or WhatsApp (availability depends
   on contact details, recorded permission and connected providers), draft a first message plus
   2–3 follow-ups with editable delays (AI when configured, from the role and the evidence shown
   only), then edit, regenerate, preview, approve, activate, pause or cancel. Nothing is sent until
   you activate. WhatsApp needs a recorded opt-in and a connected WhatsApp provider; follow-ups
   stop on a reply, decline, opt-out or pause. Expressed interest is only what the candidate told
   you — never inferred.

## Product workspace (navigation and the assistant)

- **Shell** (`src/components/app-shell.tsx`): workspace switcher (switch or create a workspace) at
  the top of the sidebar; primary navigation **Home · Roles · Discover · Candidates · Interviews ·
  Integrations**; a quieter *Workspace* area (settings, team & permissions, import & export); AI
  status; and an account menu (your calendar connection, sign out). Breadcrumbs on nested pages.
- **Home** (`/home`, the landing page after sign-in): what needs a person — applicants without a
  decision, criteria to approve, CV details to confirm, Discover results, outreach drafts awaiting
  approval, outreach due, replies, and interviews to schedule or follow up — each linked to the
  exact screen (`src/lib/attention.ts`). A *Get started* checklist shows Done / To do / Optional /
  Blocked. Only real counts; no invented metrics.
- **Role workspace**: **Overview** (next work, approved criteria, owner / collaborators /
  interviewers, recent activity) · **Applicants** · **Discover** · **Shortlist** · **Interviews**,
  with *Setup* links for Criteria, Job description and ATS.
- **The assistant's steps are visible in the workflow** (`src/components/agent-run.tsx`). Discover
  shows *Review role criteria → Prepare search plan → Search connected sources → Gather evidence →
  Present results for recruiter review*; a candidate's Assessment tab shows *Parse application →
  Compare evidence with role criteria → Explain matches and gaps → Present for recruiter decision*.
  Each step is derived from stored records (done / waiting on you / blocked / not started), names
  its sources, and links to where a person edits or unblocks it. AI suggestions are labeled
  separately from human decisions. There is no chatbot, no Signals and no intent inference.
- **Loading and failure states**: route loading shows elapsed time and, after 25 s, says the
  server hasn't responded with Retry; error boundaries (`(app)/error.tsx`, `global-error.tsx`)
  replace endless spinners; database calls carry connect / pool / socket timeouts
  (`src/lib/db.ts`), so a stalled connection becomes a visible error instead of a hang.
- Integrations moved to `/integrations` (old `/settings/integrations` links redirect, keeping the
  `calendar` result parameter).

## Skill matching (evidence-backed)

- **Role setup** (role → *Criteria*): **Skills** (required / preferred, with optional aliases and
  an optional mapping to an evaluation criterion), **evaluation criteria** (required / preferred /
  informational) and the **rubric**: a minimum such as "at least 5 of 6 required skills", whether
  *Partial evidence* counts (off by default), and the required/preferred weights for the criteria
  alignment. Uploading a JD or pressing *Extract bullet points* / *Propose with AI* suggests skills
  and criteria with the JD excerpt; suggestions are not used until a recruiter approves them.
- **Per skill status**, from the candidate's CV, candidate-provided information and — for people
  saved from Discover — the linked source record only: *Evidence found*, *Partial evidence*,
  *No evidence found* (missing evidence, never proof of absence), *Needs recruiter review*.
  Recruiters can correct any status with a required note, including *Confirmed not present*.
  Every excerpt shows where it came from and its date (CV file and upload date, or source name,
  retrieval date and link).
- **Count** = required skills with *Evidence found* (+ *Partial evidence* only when enabled), shown
  as `5/6 required`. Threshold state: *Meets configured skill threshold*, *Below configured skill
  threshold*, or *Needs review* (outcome depends on unresolved skills, the assessment is out of
  date, or there was nothing to assess — then no count is shown). It is computed live
  (`src/lib/skills.ts`), shown separately from the evaluation-criteria alignment, and never hides,
  rejects, advances or "qualifies" anyone.
- **Where it appears**: Applicants (list, board, ranked), Shortlist, Discover → *Saved from
  Discover*, the candidate's Assessment tab and side panel, the role Overview (assessed / meets /
  below / needs review, real candidates only — fictional samples excluded) and the CSV export.
  Lists filter by threshold status and minimum count.
- **Refresh**: changing approved skills or criteria marks assessments out of date; a changed CV or
  candidate-provided information does too. *Reassess candidates* (role → Criteria) re-runs the
  out-of-date ones (or all) with AI when configured, otherwise with the labeled keyword check.
  Threshold, partial credit and weights apply immediately without reassessment.

## Corrections, calibration, duplicates and profile checks

- **Correction history**: every recruiter correction to a skill or criterion result is stored
  (`AssessmentCorrection`, append-only) with who, when, from/to and the note; the engine's
  original result never changes. Any earlier value can be restored (recorded as a new change).
  Corrections made before this feature have no history rows.
- **Calibration** (Workspace → Calibration): per-criterion correction and "not enough evidence"
  rates, evidence recruiters overruled by source and generator, shortlist/interview rates by
  skill-threshold and criteria-alignment band, and assessments that changed after interview
  scorecards. Period, n and denominator shown; under 5 reads "Insufficient data". Descriptive
  only — nothing changes model behaviour.
- **Possible duplicates** (Candidates → Possible duplicates): normalized email, phone (last 10
  digits) and profile URL = high confidence; name + company = medium; name only = low/uncertain.
  Recruiters link (same person), dismiss or defer, with an undo. Nothing is merged, moved or
  deleted; both records keep their applications, assessments, interviews and outreach.
- **Profile checks** (candidate → CV & profile): possible/linked duplicates, details that differ
  between the Talyn record and a linked source record (with source and retrieval date), ATS
  conflicts, and a plain "claims not verified" statement. No authenticity score; contact-control
  and identity checks aren't offered because no consent-based process exists.
- **Pool estimate** (role → Discover): counts people already in Talyn whose CV or provided
  information mentions each saved must-have skill, the effect of moving each to Preferred, and
  location. External providers are listed as not included (none offers a pre-search count).
- **Interest** records the channel and when/where the candidate said it; unrecorded = Unknown.
- **Reordering** skills and criteria within a group doesn't mark assessments out of date.

## Role workspace: Applicants · Discover · Shortlist

Each role has three people tabs, kept deliberately separate:

- **Applicants** (inbound) — people who applied: added manually, from a CV, by CSV import or from
  the ATS. List with search (name, title, company, or any skill in the CV), stage and review-status
  filters; Board and Ranked views. Each row shows evidence *found / uncertain / missing* from the
  latest assessment (not a score) and **Shortlist · Hold · Reject**. Reject asks for a job-related
  reason. None of these moves the pipeline stage, and none is ever chosen by AI.
- **Discover** (outbound) — people a recruiter finds; see *Discover* below.
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
