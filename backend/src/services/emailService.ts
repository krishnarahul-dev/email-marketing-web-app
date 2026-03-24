import dns from 'node:dns';
import nodemailer from 'nodemailer';
import SMTPTransport from 'nodemailer/lib/smtp-transport';
import { config } from '../config';
import { SendEmailParams } from '../types';

dns.setDefaultResultOrder('ipv4first');

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

const smtpOptions: SMTPTransport.Options = {
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT || 587),
  secure: false,
  connectionTimeout: 30000,
  greetingTimeout: 30000,
  socketTimeout: 30000,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
};

const transporter = nodemailer.createTransport(smtpOptions);

export async function sendEmail(params: SendEmailParams): Promise<string> {
  await rateLimiter.acquire();

  const info = await transporter.sendMail({
    from: params.fromName ? `${params.fromName} <${params.from}>` : params.from,
    to: params.to,
    subject: params.subject,
    html: params.htmlBody,
    text: params.textBody,
    replyTo: params.replyTo,
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

  if (!info.messageId) {
    throw new Error('SMTP did not return a messageId');
  }

  return info.messageId;
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