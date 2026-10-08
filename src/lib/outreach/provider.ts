import "server-only";

/**
 * Email sending providers. None is configured for this workspace, so Talyn never sends email
 * itself: recruiters send approved messages from their own mail client and record them as sent
 * ("recruiter-recorded"). Delivered / bounced / replied are only marked provider-confirmed when
 * a configured provider reports them.
 *
 * To add a provider: implement EmailProvider (credentials from environment variables), return it
 * from getEmailProvider(), and add a webhook route that maps provider events to OutreachEvents
 * with providerConfirmed = true.
 */
export interface EmailProvider {
  key: string;
  label: string;
  send(msg: { to: string; from: string; replyTo?: string; subject: string; text: string }): Promise<{ providerMessageId: string }>;
}

export function getEmailProvider(): EmailProvider | null {
  return null;
}

export const SENDING_SETUP_HINT =
  "No email provider is connected, so Talyn doesn't send email. Send approved messages from your own mail client and record them as sent. To enable sending, choose an email provider and add its credentials.";
