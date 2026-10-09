import "server-only";
import type { DiscoveryBrief } from "@prisma/client";
import { EMPTY_BRIEF, type BriefFields, type Provenance, type WorkArrangement } from "./brief";

const arr = (json: string) => {
  try {
    const v = JSON.parse(json);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
};

export function briefFields(b: DiscoveryBrief | null): BriefFields {
  if (!b) return { ...EMPTY_BRIEF };
  return {
    roleName: b.roleName,
    altTitles: arr(b.altTitlesJson),
    skillsRequired: arr(b.skillsRequiredJson),
    skillsPreferred: arr(b.skillsPreferredJson),
    exclusions: arr(b.exclusionsJson),
    minYears: b.minYears,
    maxYears: b.maxYears,
    location: b.location,
    workArrangement: (b.workArrangement as WorkArrangement | null) ?? null,
  };
}

export function briefProvenance(b: DiscoveryBrief | null): Provenance {
  try {
    return b ? (JSON.parse(b.provenanceJson) as Provenance) : {};
  } catch {
    return {};
  }
}

export function briefColumns(f: BriefFields) {
  return {
    roleName: f.roleName,
    altTitlesJson: JSON.stringify(f.altTitles),
    skillsRequiredJson: JSON.stringify(f.skillsRequired),
    skillsPreferredJson: JSON.stringify(f.skillsPreferred),
    exclusionsJson: JSON.stringify(f.exclusions),
    minYears: f.minYears,
    maxYears: f.maxYears,
    location: f.location,
    workArrangement: f.workArrangement,
  };
}
