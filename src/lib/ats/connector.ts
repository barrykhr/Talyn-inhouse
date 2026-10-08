import "server-only";

/**
 * ATS connector interface. No ATS has been selected for this workspace, so no connector is
 * active. CSV import/export remains the supported path. See docs/ATS_INTEGRATION.md for field
 * ownership, duplicate/conflict handling and sync-failure behaviour that a connector must follow.
 */

export type AtsCandidate = { externalId: string; fullName: string; email?: string | null; phone?: string | null; currentTitle?: string | null; currentCompany?: string | null; updatedAt: string };
export type AtsStageChange = { externalApplicationId: string; talynStage: string; atsStage: string };
export type SyncResult = { ok: boolean; created: number; updated: number; conflicts: { field: string; talyn: string; ats: string; externalId: string }[]; errors: string[] };

export interface AtsConnector {
  key: string;
  label: string;
  configured(): boolean;
  /** Which system is the source of truth for each field (see docs). */
  ownership: Record<string, "ats" | "talyn" | "recruiter_choice">;
  pullCandidates(since: Date): Promise<AtsCandidate[]>;
  /** Pushes a recruiter-made stage change. Never called for AI output. */
  pushStageChange(change: AtsStageChange): Promise<void>;
}

export function getAtsConnector(): AtsConnector | null {
  return null;
}

export const ATS_SETUP_HINT =
  "No ATS is connected. Tell us which ATS you use and provide API credentials with read access to candidates/applications (and write access to stages, if Talyn should push stage changes). CSV import/export works in the meantime.";
