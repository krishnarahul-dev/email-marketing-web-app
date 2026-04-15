import { Worker, Job } from 'bullmq';
import { createRedisConnection } from '../config/redis';
import { sendEmailWithRetry } from '../services/emailService';
import { query } from '../config/database';
import { EmailSendJobData } from '../services/queueService';

export function startEmailSendWorker(): Worker {
  const worker = new Worker<EmailSendJobData>(
    'email-send',
    async (job: Job<EmailSendJobData>) => {
      const { emailLogId, to, subject, htmlBody, textBody, configurationSet, workspaceId } = job.data;

      try {
        // Check suppression list
        const suppressed = await query(
          'SELECT id FROM suppression_list WHERE email = $1 AND workspace_id = $2',
          [to, workspaceId]
        );
        if (suppressed.rows.length > 0) {
          await query(
            "UPDATE email_logs SET status = 'failed', error_message = 'Recipient on suppression list' WHERE id = $1",
            [emailLogId]
          );
          return { status: 'suppressed' };
        }

        // Look up sequence's preferred mailbox if applicable
        let preferredMailboxId: string | null = null;
        const logRow = await query<{ sequence_id: string | null; campaign_id: string | null }>(
          'SELECT sequence_id, campaign_id FROM email_logs WHERE id = $1',
          [emailLogId]
        );
        if (logRow.rows[0]?.sequence_id) {
          const seqRow = await query<{ preferred_mailbox_id: string | null }>(
            'SELECT preferred_mailbox_id FROM sequences WHERE id = $1',
            [logRow.rows[0].sequence_id]
          );
          preferredMailboxId = seqRow.rows[0]?.preferred_mailbox_id || null;
        }

        // Send via mailbox rotation
        const result = await sendEmailWithRetry({
          workspaceId,
          to,
          subject,
          htmlBody,
          textBody,
          preferredMailboxId,
          configurationSet,
          tags: { emailLogId, workspaceId },
        });

        // Update email log with success + which mailbox sent it
        await query(
          `UPDATE email_logs SET
             status = 'sent',
             ses_message_id = $1,
             sent_at = NOW(),
             mailbox_id = $2,
             from_email = $3
           WHERE id = $4`,
          [result.messageId, result.mailboxId, result.fromEmail, emailLogId]
        );

        // Record the event
        await query(
          `INSERT INTO email_events (email_log_id, workspace_id, event_type, event_data)
           VALUES ($1, $2, 'sent', $3)`,
          [emailLogId, workspaceId, JSON.stringify({ ses_message_id: result.messageId, mailbox_id: result.mailboxId })]
        );

        // Update campaign counter if applicable
        if (logRow.rows[0]?.campaign_id) {
          await query(
            'UPDATE campaigns SET sent_count = sent_count + 1 WHERE id = $1',
            [logRow.rows[0].campaign_id]
          );
        }

        return { status: 'sent', messageId: result.messageId, mailboxId: result.mailboxId };
      } catch (error: any) {
        const msg = (error.message || 'Unknown error').toString();
        console.error(`Email send failed for ${emailLogId}:`, msg);

        // NO_MAILBOX_CAPACITY: requeue for an hour later instead of failing
        if (msg.startsWith('NO_MAILBOX_CAPACITY')) {
          await query(
            "UPDATE email_logs SET error_message = $1 WHERE id = $2",
            ['Awaiting mailbox capacity (rescheduled)', emailLogId]
          );
          throw new Error('NO_MAILBOX_CAPACITY:Reschedule');
        }

        // Don't mark as 'failed' for transient errors, let BullMQ retry handle it
        const isPermanent = !msg.includes('Throttling') && !msg.includes('TooManyRequests') && !msg.includes('TemporaryFailure');
        if (isPermanent) {
          await query(
            "UPDATE email_logs SET status = 'failed', error_message = $1 WHERE id = $2",
            [msg.substring(0, 500), emailLogId]
          );
        }

        throw error;
      }
    },
    {
      connection: createRedisConnection(),
      concurrency: 5,
      limiter: { max: 14, duration: 1000 }, // 14 per second SES default
    }
  );

  worker.on('completed', (job) => {
    console.log(`Email send job ${job.id} completed`);
  });

  worker.on('failed', (job, err) => {
    console.error(`Email send job ${job?.id} failed:`, err.message);
  });

  console.log('Email send worker started');
  return worker;
}
