import "server-only";
import { AiRequestError, DISCOVERY_BRIEF_VERSION, aiStatus, extractDiscoveryBriefWithAi } from "../ai";
import { locateQuote, sectionAt } from "../evidence";
import { logError } from "../log";
import { EMPTY_BRIEF, type BriefFields, type Prov, type Provenance, type WorkArrangement } from "./brief";

export type BriefSuggestion = { fields: BriefFields; provenance: Provenance; extractor: string; notice: string | null };

const PARSER_VERSION = "parser:discovery-brief-v1";

/** Suggests discovery fields from a JD. Nothing is stated that the JD doesn't say; gaps stay empty and are labeled. */
export async function suggestBriefFromJd(pages: string[], fallbackTitle: string | null): Promise<BriefSuggestion> {
  const text = pages.join("\n\n");
  const ai = aiStatus();
  if (ai.configured) {
    try {
      const r = await extractDiscoveryBriefWithAi(text.slice(0, 60000));
      return fromAi(pages, r, `ai:${ai.provider}:${ai.model}/${DISCOVERY_BRIEF_VERSION}`);
    } catch (err) {
      if (!(err instanceof AiRequestError)) logError("discovery.brief_ai_failed", err);
      return { ...heuristic(pages, fallbackTitle), notice: `AI extraction failed${err instanceof AiRequestError ? ` (${err.message})` : ""} — a basic parser was used. Expect fewer suggestions.` };
    }
  }
  return { ...heuristic(pages, fallbackTitle), notice: "AI is not configured, so a basic parser was used. Check every field; skills come from a fixed list of common terms." };
}

function locate(pages: string[], quote: string | null | undefined): { quote: string | null; page: number | null; verified: boolean } {
  if (!quote?.trim()) return { quote: null, page: null, verified: false };
  const e = locateQuote({ resumePages: pages, profileText: "" }, quote, "resume");
  return { quote: e.quote, page: e.verified ? (e.page ?? (pages.length === 1 ? 1 : null)) : null, verified: e.verified };
}

function fromAi(pages: string[], r: Awaited<ReturnType<typeof extractDiscoveryBriefWithAi>>, extractor: string): BriefSuggestion {
  const prov: Provenance = {};
  const scalar = <T,>(v: { value: T; source_quote: string } | null, key: keyof BriefFields): T | null => {
    if (!v) {
      prov[key] = { status: "not_stated" };
      return null;
    }
    const loc = locate(pages, v.source_quote);
    prov[key] = { status: loc.verified ? "from_jd" : "inferred", quote: loc.quote, page: loc.page, verified: loc.verified };
    return v.value;
  };
  const list = (xs: { value: string; source_quote: string }[], key: keyof BriefFields) => {
    const items: NonNullable<Prov["items"]> = {};
    const values: string[] = [];
    for (const x of xs) {
      const v = x.value.trim().slice(0, 80);
      if (!v || values.some((y) => y.toLowerCase() === v.toLowerCase())) continue;
      const loc = locate(pages, x.source_quote);
      values.push(v);
      items[v] = { quote: loc.quote, verified: loc.verified };
    }
    prov[key] = values.length ? { status: Object.values(items).every((i) => i.verified) ? "from_jd" : "inferred", items } : { status: "not_stated" };
    return values.slice(0, 25);
  };
  const minYears = scalar(r.min_years, "minYears");
  const maxYears = scalar(r.max_years, "maxYears");
  const fields: BriefFields = {
    roleName: scalar(r.role_name, "roleName")?.slice(0, 200) ?? "",
    altTitles: r.alternative_titles.map((t) => t.trim().slice(0, 80)).filter(Boolean).slice(0, 4),
    skillsRequired: list(r.required_skills, "skillsRequired"),
    skillsPreferred: list(r.preferred_skills, "skillsPreferred"),
    exclusions: [],
    minYears: minYears != null && minYears >= 0 && minYears <= 50 ? minYears : null,
    maxYears: maxYears != null && maxYears >= 0 && maxYears <= 50 ? maxYears : null,
    location: scalar(r.location, "location")?.slice(0, 200) ?? null,
    workArrangement: scalar(r.work_arrangement, "workArrangement") as WorkArrangement | null,
  };
  prov.altTitles = fields.altTitles.length ? { status: "inferred" } : { status: "not_stated" };
  return { fields, provenance: prov, extractor, notice: null };
}

// Common skills for the no-AI parser. Only terms that appear in the JD are suggested.
const SKILLS = `JavaScript, TypeScript, Python, Java, Kotlin, Swift, Go, Golang, Rust, Ruby, PHP, C#, C++, Scala, Elixir, SQL, NoSQL, PostgreSQL, MySQL, MongoDB, Redis, Elasticsearch, Kafka, RabbitMQ, GraphQL, REST, gRPC, React, Next.js, Vue, Angular, Svelte, Node.js, Django, Flask, FastAPI, Spring, Spring Boot, Rails, .NET, HTML, CSS, Tailwind, iOS, Android, React Native, Flutter, AWS, Azure, GCP, Google Cloud, Kubernetes, Docker, Terraform, Ansible, CI/CD, GitHub Actions, Jenkins, Linux, Prometheus, Grafana, Datadog, microservices, distributed systems, system design, machine learning, deep learning, NLP, computer vision, PyTorch, TensorFlow, scikit-learn, pandas, Spark, Airflow, dbt, Snowflake, BigQuery, Redshift, Databricks, Tableau, Looker, Power BI, Excel, statistics, A/B testing, experimentation, data modeling, ETL, LLM, security, penetration testing, SOC 2, ISO 27001, Figma, Sketch, user research, prototyping, design systems, accessibility, UX, UI, product management, roadmapping, Agile, Scrum, Jira, stakeholder management, project management, Salesforce, HubSpot, B2B sales, SaaS, account management, customer success, negotiation, lead generation, SEO, SEM, content marketing, copywriting, Google Analytics, financial modeling, FP&A, accounting, IFRS, GAAP, budgeting, forecasting, recruiting, sourcing, talent acquisition, HRIS, Workday, payroll, employee relations, onboarding, Playwright, Cypress, Selenium, test automation, QA, technical writing, Mandarin, Spanish, French, German`.split(/,\s*/);

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function heuristic(pages: string[], fallbackTitle: string | null): Omit<BriefSuggestion, "notice"> {
  const text = pages.join("\n\n");
  const prov: Provenance = {};
  const lineOf = (idx: number) => {
    const start = text.lastIndexOf("\n", idx) + 1;
    const end = text.indexOf("\n", idx);
    return text.slice(start, end === -1 ? undefined : end).trim().slice(0, 240);
  };
  // Role name: a labeled title, else the caller's (already extracted) title.
  const labeled = text.match(/^\s*(?:job title|position|role title|role)\s*[:\-–]\s*(.{2,120})$/im);
  const roleName = labeled?.[1].trim() ?? fallbackTitle ?? "";
  prov.roleName = labeled ? { status: "from_jd", quote: labeled[0].trim(), verified: true } : roleName ? { status: "inferred" } : { status: "not_stated" };

  const required: string[] = [];
  const preferred: string[] = [];
  const reqItems: NonNullable<Prov["items"]> = {};
  const prefItems: NonNullable<Prov["items"]> = {};
  for (const sk of SKILLS) {
    const m = new RegExp(`(^|[^\\p{L}\\p{N}+#.])${esc(sk)}($|[^\\p{L}\\p{N}+#])`, "iu").exec(text);
    if (!m) continue;
    const idx = m.index + m[1].length;
    const line = lineOf(idx);
    const sec = sectionAt(text, idx) ?? "";
    const isPref = /nice|bonus|preferred|plus|desirable/i.test(sec) || /nice to have|bonus|a plus|preferred/i.test(line);
    (isPref ? preferred : required).push(sk);
    (isPref ? prefItems : reqItems)[sk] = { quote: line, verified: true };
  }
  prov.skillsRequired = required.length ? { status: "from_jd", items: reqItems } : { status: "not_stated" };
  prov.skillsPreferred = preferred.length ? { status: "from_jd", items: prefItems } : { status: "not_stated" };

  // Years: "3-5 years", "3 to 5 years", "5+ years", "at least 4 years", "minimum of 2 years".
  let minYears: number | null = null;
  let maxYears: number | null = null;
  const range = /(\d{1,2})\s*(?:-|–|to)\s*(\d{1,2})\+?\s*(?:years|yrs)/i.exec(text);
  const atLeast = /(?:(?:at least|minimum(?: of)?|min\.?)\s*)?(\d{1,2})\s*\+?\s*(?:years|yrs)/i.exec(text);
  if (range) {
    minYears = Number(range[1]);
    maxYears = Number(range[2]);
    prov.minYears = prov.maxYears = { status: "from_jd", quote: lineOf(range.index), verified: true };
  } else if (atLeast) {
    minYears = Number(atLeast[1]);
    prov.minYears = { status: "from_jd", quote: lineOf(atLeast.index), verified: true };
    prov.maxYears = { status: "not_stated" };
  } else prov.minYears = prov.maxYears = { status: "not_stated" };

  const loc = text.match(/^\s*(?:location|based in|office)\s*[:\-–]\s*(.{2,120})$/im);
  prov.location = loc ? { status: "from_jd", quote: loc[0].trim(), verified: true } : { status: "not_stated" };

  let workArrangement: WorkArrangement | null = null;
  const wa = /\b(fully remote|remote[- ]first|remote|hybrid|on[- ]site|onsite|in[- ]office)\b/i.exec(text);
  if (wa) {
    const w = wa[1].toLowerCase();
    workArrangement = w.includes("remote") ? "remote" : w.includes("hybrid") ? "hybrid" : "onsite";
    prov.workArrangement = { status: "from_jd", quote: lineOf(wa.index), verified: true };
  } else prov.workArrangement = { status: "not_stated" };
  prov.altTitles = { status: "not_stated" };

  return {
    fields: { ...EMPTY_BRIEF, roleName, skillsRequired: required, skillsPreferred: preferred, minYears, maxYears, location: loc?.[1].trim() ?? null, workArrangement },
    provenance: prov,
    extractor: PARSER_VERSION,
  };
}
