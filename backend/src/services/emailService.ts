import { Resend } from 'resend';
import { config } from '../config';
import { SendEmailParams } from '../types';

// Token-bucket rate limiter
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

const resend = new Resend(process.env.RESEND_API_KEY);

export async function sendEmail(params: SendEmailParams): Promise<string> {
  await rateLimiter.acquire();

  const response = await resend.emails.send({
    from: params.fromName ? `${params.fromName} <${params.from}>` : params.from,
    to: [params.to],
    subject: params.subject,
    html: params.htmlBody,
    text: params.textBody,
    replyTo: params.replyTo ? [params.replyTo] : undefined,
    headers: {
      ...(params.configurationSet
        ? { 'X-Configuration-Set': params.configurationSet }
        : {}),
      ...Object.fromEntries(
        Object.entries(params.tags || {}).map(([key, value]) => [
          `X-Tag-${key}`,
          String(value),
        ])
      ),
    },
  });

  if (response.error) {
    throw new Error(response.error.message || 'Resend send failed');
  }

  if (!response.data?.id) {
    throw new Error('Resend did not return a messageId');
  }

  return response.data.id;
}

export async function sendEmailWithRetry(
  params: SendEmailParams,
  maxRetries: number = config.email.retryAttempts
): Promise<string> {
  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await sendEmail(params);
    } catch (error: any) {
      lastError = error;

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