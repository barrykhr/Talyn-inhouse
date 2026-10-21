# QA sample data

Fictional data for exercising Talyn end to end: 10 roles × 20 candidates. Every name, email
(`@example.com`), phone number and CV is made up. Load it into a separate workspace, not one with
real candidates.

## What's here

| File | What it is |
|---|---|
| `jd-<role>.txt` | Job description for each role (bulleted Requirements / Nice to have / Skills) |
| `jd-da.pdf`, `jd-pd.docx` | Two JDs as files, for the "Create role from a job description" upload flow |
| `candidates-<role>.csv` | 20 candidates per role for **Import & export → Import candidates** |
| `cvs/cv-<role>-<n>.pdf/.docx` | 50 CV files to upload on the candidate's **CV & profile** tab (their CSV rows have no resume text) |
| `answer-key.csv` | Which tier each candidate was written to be, and which CV file belongs to them |
| `generate.py` | Regenerates everything (`python3 generate.py`, needs `reportlab` and `python-docx`) |

Role keys: `be` Senior Backend Engineer, `da` Data Analyst, `pd` Product Designer, `ae` Account
Executive, `cs` Customer Success Manager, `sre` Site Reliability Engineer, `pm` Product Manager,
`fin` FP&A Manager, `hr` HR Business Partner, `fe` Frontend Engineer (React).

## Candidate tiers (per role)

| Rows | Tier | Written to test |
|---|---|---|
| 0–4 | strong | Evidence for every requirement — should rank at the top |
| 5–10 | medium | Evidence for about half the requirements |
| 11–14 | weak | Unrelated background — should never rank high, and must not be auto-rejected |
| 15 | gap | Strong CV with a two-year career break — must not be penalised for the gap |
| 16 | conflict | CV contradicts itself ("Total experience: 2 years" vs a longer history) |
| 17 | sparse | Title and a one-line note only |
| 18 | nomaterial | Name, email and phone only — should not be assessed |
| 19 | duplicate | Same person (name + phone) as row 0 of the previous role, different email |

## Loading it

1. Create a fresh workspace (sign up with a new email).
2. For each role: **Roles → New role → Enter manually**, paste `jd-<role>.txt` into the description
   (or upload `jd-da.pdf` / `jd-pd.docx` through **From a job description**). On the Criteria tab
   click **Extract bullet points**, then **Approve all as written**.
3. **Import & export → Import candidates**: choose `candidates-<role>.csv`, pick the role under
   "Add to role", check the column mapping (map **Candidate summary** to "Candidate-provided
   info" — it isn't auto-detected), and import.
4. Upload the files in `cvs/` on each matching candidate (see `answer-key.csv`).
5. Role → Criteria → **Reassess all**.
