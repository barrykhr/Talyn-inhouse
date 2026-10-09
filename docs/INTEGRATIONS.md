# Integrations

Talyn has five built-in integrations. **Each is off until its environment
variables are set** (Vercel → Project → Settings → Environment Variables, then redeploy).
Integrations (`/integrations`) shows which variables are set or missing — never their values — and the
controls for each integration once it's on.

| Integration | Turns on with | Until then |
| --- | --- | --- |
| Email sending (SMTP) | `SMTP_HOST`, `SMTP_USER`, `SMTP_PASS`, `OUTREACH_FROM_EMAIL`, `OUTREACH_SECRET` | Recruiters send from their own mail client and click **Record as sent**. |
| Google Calendar (interview scheduling) | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `TOKEN_ENCRYPTION_KEY`, `GOOGLE_CALENDAR_ENABLED=true`; then each person clicks **Connect Google Calendar** | Demo mode: sample availability and simulated events, clearly labeled. |
| WhatsApp (Business Platform / Cloud API) | `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_TEMPLATE_NAME` (+ optional template language, params, preview, webhook secrets) | WhatsApp drafts can be prepared; sending is disabled. |
| Sourcing provider | `SOURCING_PROVIDER_NAME`, `SOURCING_API_URL`, `SOURCING_API_KEY` | Talyn rediscovery + **Import an authorized export** (CSV). |
| ATS | `ATS_NAME`, `ATS_API_URL`, `ATS_API_KEY` (+ `ATS_PUSH_STAGES=true` for write-back), then an admin clicks **Link this workspace** | CSV import/export. |

Scheduled jobs (`vercel.json`, daily) need `CRON_SECRET`: retention, `/api/cron/outreach`,
`/api/cron/ats`. Each no-ops while its integration is off. On Vercel Hobby crons run at most
daily; on Pro you can make `/api/cron/outreach` hourly. Admins also have **Send due messages
now** and **Sync now**.

---

## 1. Email sending (SMTP)

Works with any SMTP service: Google Workspace (`smtp.gmail.com`, app password), Microsoft 365
(`smtp.office365.com`), Amazon SES, SendGrid, Postmark, Mailgun, etc. The sender address must be
authorized by that service (SPF/DKIM set up on your domain).

What Talyn does when it's on:
- Sends only **approved** messages in sequences a recruiter **activated**, when due.
- Immediately before each send it re-checks: sequence still active, candidate not opted out,
  email on file. Any failure leaves the message unsent and logs a `send_failed` event; it is
  retried on the next run.
- Adds an unsubscribe link (signed with `OUTREACH_SECRET`) and RFC 8058 one-click
  `List-Unsubscribe` headers. Unsubscribing stops **every** live sequence for that candidate and
  blocks future outreach.
- Marks a message **sent** when the mail server accepts it. That is all SMTP confirms.
- **Send me a test email** (admins) sends one message to your own address.

### Event webhook (optional)

To record delivered / bounced / replied / opted-out automatically, have your mail service — or a
small relay that translates its webhooks — call:

```
POST {APP_URL}/api/webhooks/email
Authorization: Bearer $EMAIL_WEBHOOK_SECRET
Content-Type: application/json

{ "events": [
  { "messageId": "<the Message-ID returned when Talyn sent it>", "type": "delivered" },
  { "messageId": "…", "type": "bounced" },
  { "messageId": "…", "type": "replied" },
  { "messageId": "…", "type": "opted_out" },
  { "messageId": "…", "type": "complained" }   // treated as opted_out
] }
```

Rules applied (same as recruiter-recorded outcomes): **replied** → stop sequence + reply task;
**opted_out / complained** → stop all sequences + block candidate; **bounced** → pause;
**delivered** → mark delivered. Events from the webhook are labeled provider-confirmed; unknown
message ids are ignored. Up to 500 events per request.

---

## 1a. Google Calendar (interview scheduling)

**What Talyn does with it.** From an interview plan, a recruiter picks interviewers, duration,
date range, working hours and time zone. Talyn reads **free/busy only** for interviewers who
connected their own calendar (or who shared their calendar's free/busy with the recruiter),
combines it with availability typed in by hand, and proposes slots. Interviewers with neither are
shown as *unknown*, never as free. After the recruiter reviews and clicks **Schedule interview**,
Talyn rechecks free/busy and creates **one** event on the recruiter's calendar with the candidate
and interviewers as attendees (`sendUpdates=all`, so Google sends the invitations) and a new Google
Meet link when "Google Meet" is chosen. The event ID is derived from a per-confirmation key, so a
retried request can't create a second event. Reschedule (PATCH) and cancel (DELETE) update the same
Google event and notify attendees. Talyn never reads event titles, descriptions or attendees of
anyone's other events.

**Scopes** (requested only when a user clicks Connect — incremental authorization, never at
sign-in): `openid`, `email`, `https://www.googleapis.com/auth/calendar.freebusy`,
`https://www.googleapis.com/auth/calendar.events.owned`. No Gmail, Drive, Contacts or full
calendar access. Refresh tokens are encrypted with AES-256-GCM (`TOKEN_ENCRYPTION_KEY`) and stored
server-side only; **Disconnect** revokes at Google and deletes them. Revoked/expired access,
missing permissions, rate limits and timeouts are reported with a reconnect/retry path.

**Google Cloud setup**

1. In Google Cloud Console, use the project that holds Talyn's existing OAuth client (Google
   sign-in), or create one.
2. **APIs & Services → Library → Google Calendar API → Enable.**
3. **OAuth consent screen** (Google Auth Platform → Data access): add the scopes
   `.../auth/calendar.freebusy` and `.../auth/calendar.events.owned` (plus `openid`, `email`).
   Calendar scopes are *sensitive*: for an **Internal** app (Google Workspace, your own users)
   no verification is needed; for an **External** app, add test users while in testing and submit
   the app for Google's verification before general use.
4. **Credentials → your OAuth 2.0 Client ID (Web application) → Authorized redirect URIs**: add
   `https://<your-domain>/api/calendar/callback` (and `http://localhost:3000/api/calendar/callback`
   for local development). Keep the existing `/api/auth/google/callback` for sign-in.
5. In Vercel → Settings → Environment Variables set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`
   (if not already), `APP_URL`, `TOKEN_ENCRYPTION_KEY` (e.g. `openssl rand -base64 48`) and
   `GOOGLE_CALENDAR_ENABLED=true`, then redeploy.
6. Each recruiter and interviewer opens **Integrations (`/integrations`) → Google Calendar → Connect**
   (or **Connect** on the scheduling screen). Google Meet links require a Google Workspace or
   personal Google account where Meet is available for that calendar; otherwise the event is created
   without one and Talyn says so.

---

## 1b. WhatsApp (WhatsApp Business Platform, Cloud API)

Business-initiated WhatsApp messages must use a template approved in your WhatsApp Business
account. Talyn therefore sends **your approved template**, filling its body parameters in the
order given by `WHATSAPP_TEMPLATE_PARAMS` (default `first_name,role_title,company,recruiter_name`;
add `message` only if your approved template has a free-text field for the drafted text).
`WHATSAPP_TEMPLATE_PREVIEW` (the template text with `{{1}}`, `{{2}}`…) lets recruiters preview
exactly what will be sent.

Sending is enabled only when all of these hold: the provider is configured, the recruiter approved
every message and activated the sequence, the candidate has a phone number with a country code,
a **recorded WhatsApp opt-in** (who recorded it, when, and how it was obtained), and no opt-out.
These are re-checked immediately before each send.

Webhook (optional, recommended): set the callback URL to `{APP_URL}/api/webhooks/whatsapp`, the
verify token to `WHATSAPP_VERIFY_TOKEN`, and subscribe to `messages`. POSTs are verified with
`WHATSAPP_APP_SECRET` (`X-Hub-Signature-256`). A reply stops follow-ups and creates a task;
delivery/failure statuses are recorded as provider-confirmed. Message text is not stored.

---

## 2. Sourcing provider contract

Talyn never scrapes websites or automates logins. Connect a source your organization is licensed
to use by exposing (or wrapping it in) one HTTPS endpoint:

```
POST $SOURCING_API_URL
Authorization: Bearer $SOURCING_API_KEY

{ "filters": { "titles": [], "skills_required": [], "skills_preferred": [], "locations": [],
               "seniority": [], "industries": [], "exclusions": [] },
  "booleanQuery": "(\"Backend Engineer\" OR …) AND …",
  "years": { "min": 5, "max": null },   // from the reviewed Discover fields; may be null
  "limit": 100 }
```

Response:

```
{ "estimatedTotal": 1234,                // optional
  "profiles": [ {
    "id": "provider-record-id",          // required
    "name": "Full Name",                 // required
    "url": "https://…",                  // link to the record in the provider (optional)
    "title": "…", "company": "…", "location": "…",
    "email": "…",                        // only if your licence includes contact data
    "linkedinUrl": "https://…",
    "skills": ["…"],
    "summary": "…",
    "experience": [ { "title": "…", "company": "…", "start": "2021-03", "end": null, "description": "…" } ],
    "updatedAt": "2026-08-01T00:00:00Z"  // used for staleness (>18 months = stale)
  } ] }
```

Talyn matches every signal against the returned text and quotes it; profiles with no update date
or little text are flagged *limited evidence*; duplicates are detected by email, LinkedIn URL, or
name + company; exclusions are set aside, never deleted. Malformed records are skipped. Nothing is
contacted, rejected or added to a pipeline automatically.

### Authorized export import (available now)

Role → Sourcing → *Import an authorized export*: a CSV (≤ 1,000 rows, ≤ 4 MB) with columns
`name` (required), `title`, `company`, `location`, `email`, `linkedin_url`, `profile_url`,
`skills`, `summary`, `updated_at`, `id`. The recruiter names the source and confirms the licence;
both are recorded. Rows are matched against the latest saved search and reviewed like any other
results.

---

## 3. ATS contract

No specific ATS is assumed. Point `ATS_API_URL` at an endpoint implementing this contract —
directly, or via a thin adapter in front of your ATS's API (Greenhouse, Lever, Ashby, Workable,
SmartRecruiters, Workday, …). A dedicated connector can replace the adapter later without other
changes (`src/lib/ats/connector.ts`).

```
GET  {ATS_API_URL}/jobs
  → { "jobs": [ { "id": "…", "title": "…", "status": "open" } ] }

GET  {ATS_API_URL}/jobs/{jobId}/stages
  → { "stages": [ "Application Review", "Phone Screen", "Onsite", "Offer", "Hired", "Rejected" ] }

GET  {ATS_API_URL}/candidates?updated_since=<ISO date>&cursor=<cursor>
  → { "candidates": [ {
        "id": "…", "name": "…", "email": "…", "phone": "…", "location": "…",
        "title": "…", "company": "…", "linkedinUrl": "…",
        "updatedAt": "<ISO date>",
        "applications": [ { "id": "…", "jobId": "…", "stage": "Phone Screen" } ]
      } ],
      "nextCursor": "…" | null }

POST {ATS_API_URL}/applications/{applicationId}/stage      (only if ATS_PUSH_STAGES=true)
  { "stage": "Phone Screen", "changedBy": "Recruiter Name", "changedAt": "<ISO date>" }
  → any 2xx
```

All requests carry `Authorization: Bearer $ATS_API_KEY`. How Talyn uses it:

1. **Link** — an admin links one workspace (only one workspace can sync with an ATS).
2. **Per role** — on the role's **ATS** tab, link the role to an ATS job and map each Talyn stage
   to an ATS stage or *Don't sync*.
3. **Pull** (daily, or **Sync now**) — incremental since the last successful sync. Match by ATS id
   → email → otherwise create (labeled *From ATS*). Field rules in
   [ATS_INTEGRATION.md](ATS_INTEGRATION.md): a field is written only if Talyn's value is empty or
   was last set by the ATS; otherwise an **ATS difference** is queued for a recruiter (Keep Talyn
   value / Use ATS value). Empty ATS values never erase Talyn data. Applications attach only to
   linked roles; a *mapped* ATS stage change moves the Talyn stage (a person made it in the ATS),
   unless a Talyn change is still waiting to be pushed.
4. **Push** — only stage changes a recruiter makes in Talyn, never AI output. Unmapped stages are
   recorded as *not synced*. Pushes go in order per application with exponential backoff (5
   attempts); permanent failures appear in the queue and Settings with **Retry** / **Dismiss**.
5. **Failures** — a failed pull changes nothing further and is shown in sync history; the next run
   resumes from the last successful sync. Logs hold ids and counts only.
6. **Unlink** — stops syncing, cancels unsent pushes, keeps existing records.
