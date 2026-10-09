# Talyn guide

> Generated from `src/content/guide.json` — the same content as the in-app Guide (Workspace → Guide). The in-app version also shows live setup status.

Where each Talyn feature lives, what it needs, and how to use it. The badge next to each feature reads this workspace's real configuration: Ready means it works now; Needs setup means an integration isn't connected and the feature shows a setup or demo state instead.

## Getting around

### Sidebar, search and workspaces

**Where:** Left sidebar on every page (`/home`)

**Needs:** Works now — no integration needed

1. Use the main areas: Home, Queue, Roles, Discover, Candidates, Interviews, Integrations.
2. Workspace settings, Team & permissions, Calibration, Import & export and this Guide are under Workspace.
3. Press ⌘K (Ctrl+K) or click “Search or jump to…” to open any role, candidate or screen.
4. Click the workspace name at the top to switch workspaces or create a new one.
5. Your name at the bottom opens the account menu: your calendar connection and Sign out.

_The thin blue bar at the very top shows a page is loading. Motion stops if your device is set to reduce motion._

### Home

**Where:** Home (`/home`)

**Needs:** Works now — no integration needed

1. Check “Needs your attention”: applicants without a decision, criteria to approve, CV details to confirm, Discover results, outreach drafts, replies and interviews to schedule.
2. Click any item to go straight to where the work happens.
3. Follow “Get started” until each step shows Done (it disappears when the required steps are complete).

_Counts are real records only._

### Queue

**Where:** Queue (sidebar; the badge shows how many items are waiting) (`/queue`)

**Needs:** Works now — no integration needed

1. Work through what's waiting: CV details to confirm, information requests and their follow-ups, assessments to review, decisions, outreach due, replies, Discover results, ATS differences and interview scorecards.
2. Click an item to open the exact place to act. Empty sections are listed in one line at the bottom.

_Home shows a dot when something needs attention; the Queue badge is the count._

## Roles, skills and criteria

### Create a role

**Where:** Roles → New role (`/roles/new`)

**Needs:** Works without AI; better with AI

1. Choose “From a job description” to upload a PDF/DOCX, or “Enter manually”.
2. Review the details Talyn read from the JD (each shows the excerpt it came from) and save.
3. Set the status (Draft, Open, On hold, Closed) with Edit role → Status. Approving criteria does not change the status.

_With AI on, details are read by AI; otherwise a basic parser reads labelled lines and bullet points._

### Role Overview

**Where:** Role → Overview (`/roles`)

**Needs:** Works now — no integration needed

1. See the next work for the role, its approved skills and criteria, the skill-matching summary, people on the role and recent activity.
2. Use the tabs: Applicants, Discover, Shortlist, Interviews; Criteria and Job description are under Setup.

_Skill-matching numbers are evidence-based matches, not hiring decisions. Fictional sample people are excluded._

### Skills and evaluation criteria

**Where:** Role → Criteria (`/roles`)

**Needs:** Works without AI; better with AI

1. Click “Extract bullet points” (no AI) or “Propose with AI” to get suggestions from the JD. Suggestions are not used until approved.
2. Approve, edit, reject or reclassify each suggestion (Skill or Evaluation criterion; Required, Preferred or Informational).
3. Use “+ Add skill” for a named skill. Add other names in “Also counts as” (e.g. Postgres for PostgreSQL) and optionally link it to an evaluation criterion.
4. Use “+ Add criterion” for broader requirements such as experience, location or domain knowledge.
5. Reorder within a group with the ↑ ↓ buttons.

_Changing approved skills or criteria marks existing assessments out of date; reordering does not._

### Skill threshold and weights

**Where:** Role → Criteria → Skill threshold and weights (`/roles`)

**Needs:** Works now — no integration needed

1. Enter the minimum, e.g. “At least 5 of 6 required skills with evidence found”.
2. Tick “Count Partial evidence” only if partial evidence should count (off by default).
3. Set the Required and Preferred weights for the evaluation-criteria calculation.
4. Click Save rubric. Every candidate's count and threshold status update immediately.

_The threshold describes evidence only. Nobody is hidden, rejected or advanced by it._

### Profile scoring (0–100) and bands

**Where:** Role → Criteria → Scoring (`/roles`)

**Needs:** Works now — no integration needed

1. Approve the role's skills and criteria first — only approved, job-related Required and Preferred items are scored.
2. Set the band cutoffs and labels (defaults: below 65 “Recommendation to reject”, 65–74 “Recommendation to consider”, 75+ “AI Screen Pass”) and the minimum evidence coverage.
3. Click “Save as new version”. Bands must rise and can't overlap or leave gaps; other roles aren't affected.
4. Click “Recalculate scores” to re-score everyone's latest assessment with the current version. Earlier scores stay in each candidate's history.

_Labels are advisory only and never reject, advance or hide anyone. Missing or unverified evidence is unknown, not a failure; too little known evidence shows Insufficient evidence instead of a colour. Criteria naming protected characteristics are refused; career gaps, formatting, writing polish, school prestige or career path need a documented “Job-related reason:”._

### Reassess candidates

**Where:** Role → Criteria → Reassess candidates (`/roles`)

**Needs:** Works without AI; better with AI

1. Click “Reassess candidates (n)” to re-run everyone whose assessment is missing or out of date, or “Reassess all”.
2. Uses AI when configured; otherwise the labelled keyword check. Rejected candidates are skipped.
3. Candidates with no CV, profile or source text show Needs review and no count.

_Decisions and stages never change when reassessing._

## Applicants and assessment

### Applicants list

**Where:** Role → Applicants (`/roles`)

**Needs:** Works now — no integration needed

1. Add applicants with “Add applicant” (with CV), “Import CSV”, or pick an existing candidate.
2. Switch between List, Board and Ranked views.
3. Read each person's required-skill count (e.g. 5/6) with Meets / Below / Needs review, and their criteria evidence.
4. Filter by search, stage, review status, skill threshold and minimum required skills; sort by most required skills evidenced.
5. Record Shortlist, Hold or Reject (Reject needs a job-related reason).

_Only people who applied appear here. People found in Discover appear in Discover and Shortlist, labelled Discovered._

### Candidate assessment

**Where:** Candidate → Assessment tab (`/candidates`)

**Needs:** Works without AI; better with AI

1. Click “Assess with AI” or “Keyword check (no AI)”.
2. In Skills, open any skill to see the excerpt, where it came from (CV file, candidate information or linked source) and its date.
3. Use “Correct this status”, choose the right status and write a note. “Confirmed not present” is only for something you checked.
4. Open “Correction history” to see every change with who and when, and restore an earlier value.
5. Review Evaluation criteria the same way, then “Mark as reviewed”.
6. Review the AI recommendation (accept, edit or override), suggest follow-up questions, and record your decision in the side panel.

_“No evidence found” means missing evidence, not proof the candidate lacks the skill. The skill count is separate from the criteria score and is never a decision._

### Profile score on a candidate

**Where:** Candidate → side panel → Profile score (`/candidates`)

**Needs:** Works now — no integration needed

1. Right after an assessment, a pop-up shows the score and band, evidence coverage and required skills, with Shortlist / Hold / Reject. Reopen it any time with “Review score & decide” in the side panel.
2. Open “How this score was calculated” for every criterion's weight, result, credit, points and excerpt count, and the scoring version.
3. Correct a skill or criterion if the evidence is wrong — the score is re-recorded and the earlier one kept in “Score history”.
4. If the candidate asks for another way to be assessed, set Alternative assessment to Requested. The screening score is then not shown or used. Don't record why.

_Lists show the same advisory chip next to each applicant, shortlisted and saved Discover person._

### Profile checks

**Where:** Candidate → CV & profile → Profile checks (`/candidates`)

**Needs:** Works now — no integration needed

1. Review flags: possible or linked duplicate, details that differ from a linked source record (with source and date), and ATS conflicts.
2. Click “Request clarification” to add a task with the questions to your queue (nothing is sent to the candidate).

_Talyn never labels a person fake. No claim is marked verified because no verification process is configured. Contact-control and identity checks are not available._

### Possible duplicates

**Where:** Candidates → Possible duplicates (button appears when there are some) (`/candidates/duplicates`)

**Needs:** Works now — no integration needed

1. Compare the two records side by side, with the reason and confidence (High: shared email, phone or profile URL; Medium: name and company; Low: name only).
2. Choose “Same person — link”, “Different people” or “Decide later”, with an optional note.
3. Use “Undo decision” to reopen any decision.

_Nothing is merged or deleted. Linked records keep their own roles, assessments, interviews and outreach._

### Shortlist

**Where:** Role → Shortlist (`/roles`)

**Needs:** Works now — no integration needed

1. See everyone shortlisted from Applicants and everyone saved from Discover, each labelled Applied or Discovered.
2. Filter by origin, skill threshold and minimum required skills; open a skill count to see the evidence.

## Discover (sourcing)

### Search setup and Boolean

**Where:** Discover → Start a search, or Role → Discover (`/discover`)

**Needs:** Works without AI; better with AI

1. Upload a JD to suggest the fields, or fill them in: role title, other titles, required and preferred skills, years, location, work arrangement, exclusions.
2. Check each field's label (from the JD, a suggestion, or not stated) and edit.
3. Review and edit the generated Boolean search.
4. Choose sources and click Search.

_The assistant panel shows each step: criteria, plan, sources, evidence, your review._

### Pool estimate

**Where:** Role → Discover → Pool estimate (`/discover`)

**Needs:** Works now — no integration needed

1. Save the search setup with required skills, then click “Estimate pool”.
2. Read how many people already in Talyn mention all must-have skills, which skill narrows the pool most, and the pool if a skill moved to Preferred.

_Covers Talyn's own candidates only (no external provider offers a count before searching). Years of experience aren't applied. Under 5 people shows Insufficient data._

### Sources

**Where:** Role → Discover → Search setup → Sources (`/integrations`)

**Needs:** Needs a sourcing provider for live external search

1. Talyn rediscovery (your existing candidates) always works.
2. A licensed provider can be searched once its credentials are added (see Integrations).
3. Demo mode uses fictional people, labelled Sample · fictional everywhere, and is never a live search.

_Talyn never scrapes websites. An authorized CSV export can be imported on the Discover tab._

### Review results

**Where:** Role → Discover → Results (`/discover`)

**Needs:** Works now — no integration needed

1. Review each person's evidence, source and retrieval date; Save or Dismiss.
2. Saved people appear in “Saved from Discover” and the Shortlist as Discovered, with their required-skill count after reassessment.

_Ordering by matched terms is a review aid, not a score._

## Outreach, interest and permission

### Ask the candidate (assistant follow-up)

**Where:** Candidate → side panel → Information requests (also listed in the review queue and on Home) (`/queue`)

**Needs:** Needs WhatsApp Cloud API for WhatsApp sending; Needs SMTP for sending (manual sending otherwise); Works without AI; better with AI

1. Create an information request (or “Create information request” from an AI recommendation).
2. Click “Ask on WhatsApp” or “Ask by email”. The assistant drafts a short message with your questions — nothing is sent yet.
3. Edit if needed, then “Approve & send”. Without a connected provider, copy it, send it yourself and click “Mark as sent”.
4. When the candidate replies, the request shows “Candidate replied” (reported by WhatsApp or your mail service, or click “They replied”).
5. Paste or summarise the answers and click “Add answers to profile” — optionally reassessing straight away.

_Needs the candidate's contact details, no opt-out, and for WhatsApp a recorded opt-in. WhatsApp only lets businesses start a conversation with an approved template: the questions go in your template's “message” parameter, or as free text within 24 hours of the candidate's last message. Talyn doesn't store reply text; answers you add are labelled with channel and date._

### Email and WhatsApp sequences

**Where:** Candidate → Outreach tab (or Outreach from a saved Discover person) (`/candidates`)

**Needs:** Needs SMTP for sending (manual sending otherwise); Needs WhatsApp Cloud API for WhatsApp sending

1. Choose Email or WhatsApp and 2 or 3 follow-ups; draft the sequence.
2. Check which candidate facts were used and their sources; edit each message and its delay.
3. Approve every message, then Activate. Nothing is sent before that.
4. Without a connected provider, send the message yourself and mark it sent.

_Follow-ups stop on a reply, decline, opt-out, bounce or pause. Delivery and reply states come from the provider only when one is connected. WhatsApp needs a recorded opt-in._

### Expressed interest and contact permission

**Where:** Candidate → Outreach → Expressed interest (`/candidates`)

**Needs:** Works now — no integration needed

1. Record what the candidate said: Interested, Not now or Declined.
2. Choose the channel they used and note when/where (e.g. “reply to email of 3 Oct”), plus any restriction.
3. Record WhatsApp permission or an opt-out separately.

_Interest shows Unknown until recorded. It is never inferred from profiles, job changes or AI, and never triggers contact or a decision._

## Interviews and scheduling

### Interview plans, scorecards and debrief

**Where:** Role → Interviews, or Interviews (`/interviews`)

**Needs:** Works without AI; better with AI

1. Click “Create interview plan” for a shortlisted candidate. The plan is built from the role's approved skills and criteria.
2. Edit competencies, questions and stages; assign interviewers to each stage; share the plan.
3. Each interviewer submits their own scorecard. Others' scores stay hidden until they submit.
4. Open the debrief to see evidence by competency, disagreements and uncovered competencies, then record the team decision.

_No recording or transcription. The decision is always recorded by a person._

### Scheduling with Google Calendar

**Where:** Interview plan → Schedule a stage; your connection: account menu → My calendar connection (`/integrations#calendar`)

**Needs:** Needs Google Calendar setup (demo mode otherwise)

1. Each interviewer connects their own Google Calendar (free/busy and the events Talyn creates only).
2. On a stage, propose times from shared free/busy, review, and create the event with a Meet link.
3. Reschedule or cancel from the same screen.

_Without Google set up, scheduling runs in a labelled demo mode and times are entered manually. Talyn never reads event details._

## Workspace, team and quality

### Calibration

**Where:** Workspace → Calibration (`/settings/calibration`)

**Needs:** Works now — no integration needed

1. Pick a period (30 days, 90 days or 12 months).
2. See which skills and criteria are corrected most or lack evidence, which evidence recruiters overruled, shortlist and interview rates by band, and assessments that changed after interviews.

_Every rate shows its denominator; under 5 reads Insufficient data. It describes what happened and does not change how Talyn assesses._

### Scoring validation & fairness (admins)

**Where:** Workspace settings → Scoring validation & fairness (`/settings/scoring`)

**Needs:** Works now — no integration needed

1. For each role and scoring version, review score distribution, outcomes by band, correction and insufficient-evidence rates.
2. Optionally turn on monitoring with self-reported demographic data (requires an attestation), import responses as email,category,value, and compare groups. Groups under 10 are suppressed.
3. Review any version flagged for a material difference and record what was decided.
4. Set the alternative-assessment instructions recruiters share with candidates.

_Descriptive statistics only: they can't show a process is fair, valid or compliant. Demographic data never appears in candidate or recruiter views and is never inferred._

### Team and permissions

**Where:** Workspace → Team & permissions (`/settings#team`)

**Needs:** Works now — no integration needed

1. Admins create invite links for recruiters, hiring managers or admins.
2. Change roles or remove members from the same list.

_Only admins can invite, change retention, view the audit log, link the ATS or delete the workspace._

### Integrations

**Where:** Integrations (`/integrations`)

**Needs:** Works now — no integration needed

1. See each integration's status, which variables are set or missing (never their values), and setup steps.
2. Connect your own Google Calendar here.

_Credentials are added as environment variables in Vercel, then redeploy._

### Import and export

**Where:** Workspace → Import & export; Role → Export CSV (`/import`)

**Needs:** Works now — no integration needed

1. Import candidates from CSV (existing emails are skipped).
2. Export a role's pipeline with decisions, skill counts and per-criterion results.

### Success measures, audit log and retention

**Where:** Workspace settings (`/settings`)

**Needs:** Works now — no integration needed

1. Success measures: definitions and values from real data.
2. Audit log (admins): who viewed, exported, assessed, corrected or decided what.
3. Data retention (admins): how long inactive candidate data is kept.
