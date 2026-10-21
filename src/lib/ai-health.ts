import "server-only";
import { db } from "./db";
import { logError } from "./log";

// Deployment-wide record of whether AI requests are succeeding, so admins learn when the provider
// is failing (bad key, out of credit, model unavailable) instead of seeing quiet template fallbacks.

export type AiErrorKind = "auth" | "model" | "quota" | "rate_limit" | "connection" | "other";

export const AI_ERROR_HELP: Record<AiErrorKind, string> = {
  auth: "The API key was rejected. Replace the key in your hosting environment variables and redeploy.",
  model: "The configured model isn't available to this API key. Check the model setting or the key's access.",
  quota: "The AI account is out of credit. Add credit or raise the spending limit with your AI provider.",
  rate_limit: "The AI provider is rate limiting requests. It usually clears on its own; if it persists, check your plan's limits.",
  connection: "Talyn couldn't reach the AI provider. Check the provider's status page and your network settings.",
  other: "AI requests are failing. Check the provider's status page and your server logs.",
};

let lastOkWrite = 0;

/** Records a successful AI call. Writes at most every 10 minutes unless it clears a failure. */
export async function recordAiOk(provider: string) {
  const now = Date.now();
  try {
    if (now - lastOkWrite < 10 * 60_000) {
      const h = await db.aiHealth.findUnique({ where: { provider }, select: { failuresSinceOk: true } });
      if (!h || h.failuresSinceOk === 0) return;
    }
    lastOkWrite = now;
    await db.aiHealth.upsert({ where: { provider }, update: { lastOkAt: new Date(), failuresSinceOk: 0 }, create: { provider, lastOkAt: new Date() } });
  } catch (err) {
    logError("ai.health_write_failed", err);
  }
}

export async function recordAiFailure(provider: string, kind: AiErrorKind, text: string) {
  try {
    await db.aiHealth.upsert({
      where: { provider },
      update: { lastErrorAt: new Date(), lastErrorKind: kind, lastErrorText: text.slice(0, 300), failuresSinceOk: { increment: 1 } },
      create: { provider, lastErrorAt: new Date(), lastErrorKind: kind, lastErrorText: text.slice(0, 300), failuresSinceOk: 1 },
    });
  } catch (err) {
    logError("ai.health_write_failed", err);
  }
}

export type AiHealthView = { failing: boolean; kind: AiErrorKind | null; text: string | null; help: string | null; since: Date | null; failures: number; lastOkAt: Date | null };

/** Failing = the most recent AI call (within the last 3 days) failed. */
export async function aiHealth(provider: string | null): Promise<AiHealthView> {
  const none: AiHealthView = { failing: false, kind: null, text: null, help: null, since: null, failures: 0, lastOkAt: null };
  if (!provider) return none;
  const h = await db.aiHealth.findUnique({ where: { provider } }).catch(() => null);
  if (!h) return none;
  const recent = h.lastErrorAt && Date.now() - h.lastErrorAt.getTime() < 3 * 86_400_000;
  const failing = !!recent && h.failuresSinceOk > 0 && (!h.lastOkAt || h.lastErrorAt! > h.lastOkAt);
  const kind = (h.lastErrorKind as AiErrorKind | null) ?? null;
  return { failing, kind, text: h.lastErrorText, help: kind ? AI_ERROR_HELP[kind] : null, since: h.lastErrorAt, failures: h.failuresSinceOk, lastOkAt: h.lastOkAt };
}
