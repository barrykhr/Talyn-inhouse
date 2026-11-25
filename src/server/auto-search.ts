import "server-only";
import type { AuthContext } from "@/lib/auth";
import { db } from "@/lib/db";
import { booleanKey, buildBoolean, type BriefFields } from "@/lib/discovery/brief";
import { briefColumns, briefFields } from "@/lib/discovery/store";
import { logError } from "@/lib/log";
import { CONNECTORS } from "@/lib/sourcing/connectors";
import { executeSearch } from "./search-run";
import { parseSelection } from "@/lib/discovery/target-companies";

/**
 * Automatic Discover searches: when a role's criteria are first approved, and daily for open roles.
 * They search every connected source with the role's confirmed search fields (or fields taken from
 * its approved criteria), add only people not found before, and never contact, decide or save anyone.
 * DISCOVER_AUTO=off turns this off; DISCOVER_AUTO_SOURCES limits it to listed source keys.
 */

export const autoSearchEnabled = () => (process.env.DISCOVER_AUTO ?? "").trim().toLowerCase() !== "off";

export function autoSourceKeys(): string[] {
  const only = (process.env.DISCOVER_AUTO_SOURCES ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  return CONNECTORS.filter((c) => c.kind !== "sample" && c.configured() && (!only.length || only.includes(c.key))).map((c) => c.key);
}

/** The person automatic runs are recorded under: the workspace's first admin, named as Talyn. */
async function systemActor(orgId: string): Promise<AuthContext | null> {
  const m = await db.membership.findFirst({ where: { orgId, role: "admin" }, orderBy: { createdAt: "asc" }, include: { user: { select: { id: true, email: true } }, org: { select: { name: true } } } });
  if (!m) return null;
  return { userId: m.user.id, userName: "Talyn (automatic search)", email: m.user.email, orgId, orgName: m.org.name, membershipRole: "admin" };
}

/** Confirmed fields, or fields taken from the approved criteria and the role itself (no AI, no guessing). */
async function fieldsFor(orgId: string, roleId: string): Promise<{ brief: { booleanQuery: string }; fields: BriefFields } | null> {
  const existing = await db.discoveryBrief.findUnique({ where: { roleId } });
  if (existing) {
    const f = briefFields(existing);
    return f.skillsRequired.length || f.roleName ? { brief: existing, fields: f } : null;
  }
  const role = await db.role.findFirst({ where: { id: roleId, orgId }, select: { title: true, location: true } });
  if (!role) return null;
  const criteria = await db.criterion.findMany({ where: { roleId, orgId, status: "approved", kind: "skill" }, select: { name: true, importance: true }, orderBy: { position: "asc" } });
  if (!criteria.length) return null;
  const f: BriefFields = {
    roleName: role.title,
    altTitles: [],
    skillsRequired: criteria.filter((c) => c.importance === "essential").map((c) => c.name).slice(0, 12),
    skillsPreferred: criteria.filter((c) => c.importance === "preferred").map((c) => c.name).slice(0, 12),
    exclusions: [],
    minYears: null,
    maxYears: null,
    location: role.location?.trim() || null,
    workArrangement: null,
  };
  const booleanQuery = buildBoolean(f);
  const brief = await db.discoveryBrief.create({
    data: {
      orgId,
      roleId,
      origin: "manual",
      ...briefColumns(f),
      provenanceJson: JSON.stringify(Object.fromEntries(["roleName", "skillsRequired", "skillsPreferred", "location"].map((k) => [k, { status: "inferred", quote: "From the role's approved skills and details" }]))),
      booleanQuery,
      booleanFieldsKey: booleanKey(f),
      updatedByName: "Talyn (automatic search)",
    },
  });
  return { brief, fields: f };
}

export type AutoSearchOutcome = { roleId: string; status: "searched" | "skipped" | "failed"; added?: number; note?: string };

export async function autoSearchRole(orgId: string, roleId: string, opts: { onlyIfNoRun?: boolean } = {}): Promise<AutoSearchOutcome> {
  try {
    if (!autoSearchEnabled()) return { roleId, status: "skipped", note: "DISCOVER_AUTO is off" };
    if (opts.onlyIfNoRun && (await db.searchRun.count({ where: { orgId, roleId } }))) return { roleId, status: "skipped", note: "already searched" };
    const keys = autoSourceKeys();
    if (!keys.length) return { roleId, status: "skipped", note: "no connected sources" };
    const actor = await systemActor(orgId);
    if (!actor) return { roleId, status: "skipped", note: "no admin" };
    const got = await fieldsFor(orgId, roleId);
    if (!got) return { roleId, status: "skipped", note: "no search fields or approved skills" };
    // The recruiter's saved target companies raise matching people; they never hide anyone.
    const targets = await db.targetCompanySet.findUnique({ where: { roleId }, select: { orgId: true, selectedJson: true } });
    const targetCompanies = targets && targets.orgId === orgId ? parseSelection(targets.selectedJson) : [];
    const out = await executeSearch(actor, roleId, got.brief, got.fields, { demo: false, keys, onlyNew: true, targetCompanies });
    if ("error" in out) return { roleId, status: "skipped", note: out.error };
    return { roleId, status: out.anyOk ? "searched" : "failed", added: out.added };
  } catch (err) {
    logError("discover.auto_search_failed", err, { roleId });
    return { roleId, status: "failed" };
  }
}

/** Daily: open roles, least recently searched first, within a time budget. */
export async function autoSearchOpenRoles(budgetMs = 240_000): Promise<AutoSearchOutcome[]> {
  const started = Date.now();
  const roles = await db.role.findMany({ where: { status: "open" }, select: { id: true, orgId: true } });
  const last = await db.searchRun.groupBy({ by: ["roleId"], _max: { createdAt: true }, where: { roleId: { in: roles.map((r) => r.id) } } });
  const lastAt = new Map(last.map((l) => [l.roleId, l._max.createdAt?.getTime() ?? 0]));
  roles.sort((a, b) => (lastAt.get(a.id) ?? 0) - (lastAt.get(b.id) ?? 0));
  const out: AutoSearchOutcome[] = [];
  for (const r of roles) {
    if (Date.now() - started > budgetMs) {
      out.push({ roleId: r.id, status: "skipped", note: "time budget used; runs first tomorrow" });
      continue;
    }
    // Searched in the last 20 hours (by a recruiter or earlier today): skip.
    if (Date.now() - (lastAt.get(r.id) ?? 0) < 20 * 3600_000) {
      out.push({ roleId: r.id, status: "skipped", note: "searched recently" });
      continue;
    }
    out.push(await autoSearchRole(r.orgId, r.id));
  }
  return out;
}
