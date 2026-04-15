import {
  SESClient, SendEmailCommand, VerifyEmailIdentityCommand, GetIdentityVerificationAttributesCommand,
  DeleteIdentityCommand, GetSendQuotaCommand,
} from '@aws-sdk/client-ses';
import { decrypt } from '../utils/encryption';
import { query } from '../config/database';

interface WorkspaceCredentials {
  aws_access_key_id_encrypted: string | null;
  aws_secret_access_key_encrypted: string | null;
  aws_region: string | null;
}

const clientCache = new Map<string, { client: SESClient; expires: number }>();
const CLIENT_TTL = 5 * 60 * 1000; // 5 minutes

/**
 * Get a cached SES client for a workspace using its stored credentials.
 * Throws if credentials are not configured.
 */
export async function getSESClient(workspaceId: string): Promise<SESClient> {
  const cached = clientCache.get(workspaceId);
  if (cached && cached.expires > Date.now()) return cached.client;

  const result = await query<WorkspaceCredentials>(
    'SELECT aws_access_key_id_encrypted, aws_secret_access_key_encrypted, aws_region FROM workspaces WHERE id = $1',
    [workspaceId]
  );
  if (result.rows.length === 0) {
    throw new Error(`Workspace ${workspaceId} not found`);
  }
  const ws = result.rows[0];
  if (!ws.aws_access_key_id_encrypted || !ws.aws_secret_access_key_encrypted) {
    throw new Error('AWS SES credentials not configured for this workspace. Go to Settings → Email Sending to add them.');
  }

  const accessKeyId = decrypt(ws.aws_access_key_id_encrypted);
  const secretAccessKey = decrypt(ws.aws_secret_access_key_encrypted);
  const region = ws.aws_region || 'us-east-1';

  const client = new SESClient({
    region,
    credentials: { accessKeyId, secretAccessKey },
  });

  clientCache.set(workspaceId, { client, expires: Date.now() + CLIENT_TTL });
  return client;
}

export function invalidateSESClientCache(workspaceId: string): void {
  clientCache.delete(workspaceId);
}

/**
 * Initiate verification of a sender email address with AWS SES.
 * AWS will send an email to the address with a confirmation link.
 */
export async function verifyEmailIdentity(workspaceId: string, email: string): Promise<void> {
  const client = await getSESClient(workspaceId);
  await client.send(new VerifyEmailIdentityCommand({ EmailAddress: email }));
}

/**
 * Check verification status for a list of email identities.
 * Returns a map of email → 'Success' | 'Pending' | 'Failed' | 'TemporaryFailure' | 'NotStarted'.
 */
export async function checkVerificationStatus(
  workspaceId: string,
  emails: string[]
): Promise<Record<string, string>> {
  if (emails.length === 0) return {};
  const client = await getSESClient(workspaceId);
  const result = await client.send(new GetIdentityVerificationAttributesCommand({ Identities: emails }));
  const out: Record<string, string> = {};
  for (const email of emails) {
    out[email] = result.VerificationAttributes?.[email]?.VerificationStatus || 'NotStarted';
  }
  return out;
}

/**
 * Remove an identity from SES (also stops verification polling).
 */
export async function deleteIdentity(workspaceId: string, email: string): Promise<void> {
  try {
    const client = await getSESClient(workspaceId);
    await client.send(new DeleteIdentityCommand({ Identity: email }));
  } catch (err: any) {
    // Identity might already be gone, log and continue
    console.warn(`Could not delete SES identity ${email}:`, err.message);
  }
}

/**
 * Fetch SES sending quota and current sandbox/production status.
 * In sandbox, max24HourSend is 200 and you can only send to verified addresses.
 * In production, limits are higher and you can send to any address.
 */
export async function getSendingQuota(workspaceId: string): Promise<{
  max24HourSend: number;
  maxSendRate: number;
  sentLast24Hours: number;
  inSandbox: boolean;
}> {
  const client = await getSESClient(workspaceId);
  const result = await client.send(new GetSendQuotaCommand({}));
  // Sandbox accounts have max 200/day
  const inSandbox = (result.Max24HourSend || 0) <= 200;
  return {
    max24HourSend: result.Max24HourSend || 0,
    maxSendRate: result.MaxSendRate || 0,
    sentLast24Hours: result.SentLast24Hours || 0,
    inSandbox,
  };
}

/**
 * Send an email through SES using a specific from address.
 * Returns the SES message ID on success.
 */
export interface SESSendParams {
  workspaceId: string;
  from: string;        // verified sender email
  fromName?: string;
  to: string;
  subject: string;
  htmlBody: string;
  textBody?: string;
  replyTo?: string;
  configurationSet?: string;
}

export async function sendViaSES(params: SESSendParams): Promise<string> {
  const client = await getSESClient(params.workspaceId);

  const Source = params.fromName
    ? `${params.fromName.replace(/"/g, '')} <${params.from}>`
    : params.from;

  const command = new SendEmailCommand({
    Source,
    Destination: { ToAddresses: [params.to] },
    Message: {
      Subject: { Data: params.subject, Charset: 'UTF-8' },
      Body: {
        Html: { Data: params.htmlBody, Charset: 'UTF-8' },
        ...(params.textBody ? { Text: { Data: params.textBody, Charset: 'UTF-8' } } : {}),
      },
    },
    ...(params.replyTo ? { ReplyToAddresses: [params.replyTo] } : {}),
    ...(params.configurationSet ? { ConfigurationSetName: params.configurationSet } : {}),
  });

  try {
    const result = await client.send(command);
    if (!result.MessageId) throw new Error('SES did not return a MessageId');
    return result.MessageId;
  } catch (err: any) {
    // Translate common SES errors into actionable messages
    const code = err.name || err.Code;
    if (code === 'MessageRejected') {
      throw new Error(`SES rejected email: ${err.message}. Sender may not be verified, or recipient is in sandbox-restricted list.`);
    }
    if (code === 'MailFromDomainNotVerifiedException') {
      throw new Error(`Sender domain not verified in SES: ${params.from}`);
    }
    if (code === 'ConfigurationSetDoesNotExistException') {
      throw new Error(`Configuration set "${params.configurationSet}" not found in SES`);
    }
    if (code === 'AccountSendingPausedException') {
      throw new Error('SES account sending is paused. Check AWS SES console for details.');
    }
    if (code === 'Throttling' || code === 'TooManyRequestsException') {
      throw new Error(`SES throttling: ${err.message}`);
    }
    throw err;
  }
}
