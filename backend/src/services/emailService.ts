import { SESClient, SendEmailCommand, SendEmailCommandInput } from '@aws-sdk/client-ses';
import { config } from '../config';
import { SendEmailParams } from '../types';

const sesClient = new SESClient({
  region: config.ses.region,
  credentials: {
    accessKeyId: config.ses.accessKeyId,
    secretAccessKey: config.ses.secretAccessKey,
  },
});

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
      const waitTime = Math.ceil((1 - this.tokens) / this.refillRate * 1000);
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

export async function sendEmail(params: SendEmailParams): Promise<string> {
  await rateLimiter.acquire();

  const input: SendEmailCommandInput = {
    Source: params.fromName ? `${params.fromName} <${params.from}>` : params.from,
    Destination: {
      ToAddresses: [params.to],
    },
    Message: {
      Subject: {
        Data: params.subject,
        Charset: 'UTF-8',
      },
      Body: {
        Html: {
          Data: params.htmlBody,
          Charset: 'UTF-8',
        },
        ...(params.textBody && {
          Text: {
            Data: params.textBody,
            Charset: 'UTF-8',
          },
        }),
      },
    },
    ...(params.configurationSet && {
      ConfigurationSetName: params.configurationSet,
    }),
    ...(params.replyTo && {
      ReplyToAddresses: [params.replyTo],
    }),
    Tags: Object.entries(params.tags || {}).map(([Name, Value]) => ({ Name, Value })),
  };

  const command = new SendEmailCommand(input);
  const response = await sesClient.send(command);

  if (!response.MessageId) {
    throw new Error('SES did not return a MessageId');
  }

  return response.MessageId;
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

      // Don't retry on validation errors or permanent failures
      if (
        error.name === 'MessageRejected' ||
        error.name === 'MailFromDomainNotVerifiedException' ||
        error.Code === 'InvalidParameterValue'
      ) {
        throw error;
      }

      if (attempt < maxRetries) {
        const delay = config.email.retryDelay * Math.pow(2, attempt);
        console.warn(`Email send attempt ${attempt + 1} failed, retrying in ${delay}ms:`, error.message);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  throw lastError || new Error('Failed to send email after retries');
}
