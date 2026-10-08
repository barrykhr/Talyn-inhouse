import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { appUrl } from "../integrations/env";

// Unsubscribe links carry the message id plus an HMAC so they can't be forged or enumerated.

function mac(messageId: string) {
  const secret = process.env.OUTREACH_SECRET;
  if (!secret) throw new Error("OUTREACH_SECRET is not set");
  return createHmac("sha256", secret).update(`unsubscribe:${messageId}`).digest("base64url").slice(0, 32);
}

export function unsubscribeToken(messageId: string) {
  return `${messageId}.${mac(messageId)}`;
}

export function unsubscribeUrl(messageId: string) {
  return `${appUrl()}/unsubscribe/${unsubscribeToken(messageId)}`;
}

/** Returns the message id if the token is valid. */
export function verifyUnsubscribeToken(token: string): string | null {
  if (!process.env.OUTREACH_SECRET) return null;
  const [id, sig] = token.split(".");
  if (!id || !sig || !/^[a-z0-9]{10,40}$/i.test(id)) return null;
  const want = Buffer.from(mac(id));
  const got = Buffer.from(sig);
  return got.length === want.length && timingSafeEqual(got, want) ? id : null;
}
