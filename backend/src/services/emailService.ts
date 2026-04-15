import { sendViaSES } from './sesService';
import { reserveMailbox, releaseMailboxSlot, MailboxRow } from './mailboxService';
import { config } from '../config';

// Token-bucket rate limiter (workspace-scoped via SES MaxSendRate)
class RateLimiter {
  private tokens: number;
  private maxTokens: number;
  private refillRate: number;
  private lastRefill: number;

  constructor(maxPerSecond: number) {
    this.maxTokens = maxPerSecond;
    this.tokens = maxPerSecond;
    this.refillRate = maxPerSecond;
    this.lastRefill = Date.now();
  }

  async acquire(): Promise<void> {
    this.refill();
    if (this.tokens < 1) {
      const waitTime = Math.ceil(((1 - this.tokens) / this.refillRate) * 1000);
      await new Promise((resolve) => setTimeout(resolve, waitTime));
      this.refill();
    }
    this.tokens -= 1;
  }

  private refill(): void {
    const now = Date.now();
    const elapsed = (now - this.lastRefill) / 1000;
    this.tokens = Math.min(this.maxTokens, this.tokens + elapsed * this.refillRate);
    this.lastRefill = now;
  }
}

const rateLimiter = new RateLimiter(config.email.rateLimitPerSecond);

export interface SendEmailParams {
  workspaceId: string;
  to: string;
  subject: string;
  htmlBody: string;
  textBody?: string;
  // Optional: pin the send to a specific mailbox (sequence-level override)
  preferredMailboxId?: string | null;
  replyTo?: string;
  configurationSet?: string;
  tags?: Record<string, string>;
}

export interface SendEmailResult {
  messageId: string;
  mailboxId: string;
  fromEmail: string;
}

/**
 * Send an email using a round-robin selected mailbox (or a preferred one).
 * Returns the SES message ID and the mailbox used.
 */
export async function sendEmail(params: SendEmailParams): Promise<SendEmailResult> {
  await rateLimiter.acquire();

  const mailbox = await reserveMailbox(params.workspaceId, params.preferredMailboxId);
  if (!mailbox) {
    throw new Error(
      'NO_MAILBOX_CAPACITY: No verified mailboxes have remaining daily send capacity. Add another mailbox or wait until tomorrow.'
    );
  }

  try {
    const messageId = await sendViaSES({
      workspaceId: params.workspaceId,
      from: mailbox.from_email,
      fromName: mailbox.from_name || undefined,
      to: params.to,
      subject: params.subject,
      htmlBody: appendSignatureIfMissing(params.htmlBody, mailbox),
      textBody: params.textBody,
      replyTo: params.replyTo || mailbox.reply_to_email || undefined,
      configurationSet: params.configurationSet,
    });

    return { messageId, mailboxId: mailbox.id, fromEmail: mailbox.from_email };
  } catch (err: any) {
    // Roll back the count reservation on failure
    await releaseMailboxSlot(mailbox.id);
    throw err;
  }
}

/**
 * Send with retry — exponential backoff between attempts.
 */
export async function sendEmailWithRetry(
  params: SendEmailParams,
  maxRetries: number = config.email.retryAttempts
): Promise<SendEmailResult> {
  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await sendEmail(params);
    } catch (error: any) {
      lastError = error;

      // Don't retry on configuration errors — they won't fix themselves
      const msg = (error.message || '').toString();
      if (
        msg.includes('NO_MAILBOX_CAPACITY') ||
        msg.includes('not configured') ||
        msg.includes('not verified') ||
        msg.includes('credentials')
      ) {
        throw error;
      }

      if (attempt < maxRetries) {
        const delay = config.email.retryDelay * Math.pow(2, attempt);
        console.warn(
          `Email send attempt ${attempt + 1} failed, retrying in ${delay}ms:`,
          error.message
        );
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  throw lastError || new Error('Failed to send email after retries');
}

/**
 * Append the mailbox's signature to the HTML body if there's no existing signature marker.
 */
function appendSignatureIfMissing(html: string, mailbox: MailboxRow): string {
  if (!mailbox.signature_html) return html;
  // Skip if signature is already present (look for common markers)
  if (html.includes('<!--signature-->') || html.includes('class="signature"')) return html;
  return `${html}<!--signature--><div class="signature">${mailbox.signature_html}</div>`;
}
