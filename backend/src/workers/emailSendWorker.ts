import { Worker, Job } from 'bullmq';
import { createRedisConnection } from '../config/redis';
import { sendEmailWithRetry } from '../services/emailService';
import { query } from '../config/database';
import { EmailSendJobData } from '../services/queueService';

export function startEmailSendWorker(): Worker {
  const worker = new Worker<EmailSendJobData>(
    'email-send',
    async (job: Job<EmailSendJobData>) => {
      const { emailLogId, to, from, fromName, subject, htmlBody, textBody, configurationSet } = job.data;

      try {
        // Check suppression before sending
        const suppressed = await query(
          'SELECT id FROM suppression_list WHERE email = $1 AND workspace_id = $2',
          [to, job.data.workspaceId]
        );
        if (suppressed.rows.length > 0) {
          await query("UPDATE email_logs SET status = 'failed', error_message = 'Suppressed' WHERE id = $1", [emailLogId]);
          return { status: 'suppressed' };
        }

        // Check daily send limit
        const workspace = await query('SELECT daily_send_limit FROM workspaces WHERE id = $1', [job.data.workspaceId]);
        if (workspace.rows.length > 0) {
          const todaySent = await query(
            "SELECT COUNT(*) FROM email_logs WHERE workspace_id = $1 AND sent_at >= CURRENT_DATE AND status != 'failed'",
            [job.data.workspaceId]
          );
          if (parseInt(todaySent.rows[0].count) >= workspace.rows[0].daily_send_limit) {
            // Reschedule for tomorrow
            const tomorrow = new Date();
            tomorrow.setDate(tomorrow.getDate() + 1);
            tomorrow.setHours(9, 0, 0, 0);
            const delay = tomorrow.getTime() - Date.now();
            throw new Error(`RATE_LIMIT:Daily send limit reached. Rescheduling.`);
          }
        }

        const messageId = await sendEmailWithRetry({
          to,
          from,
          fromName,
          subject,
          htmlBody,
          textBody,
          configurationSet,
          tags: { emailLogId, workspaceId: job.data.workspaceId },
        });

        await query(
          "UPDATE email_logs SET status = 'sent', ses_message_id = $1, sent_at = NOW() WHERE id = $2",
          [messageId, emailLogId]
        );

        await query(
          `INSERT INTO email_events (email_log_id, workspace_id, event_type, event_data)
           VALUES ($1, $2, 'sent', $3)`,
          [emailLogId, job.data.workspaceId, JSON.stringify({ ses_message_id: messageId })]
        );

        // Update campaign counter
        const log = await query('SELECT campaign_id FROM email_logs WHERE id = $1', [emailLogId]);
        if (log.rows[0]?.campaign_id) {
          await query(
            'UPDATE campaigns SET sent_count = sent_count + 1 WHERE id = $1',
            [log.rows[0].campaign_id]
          );
        }

        return { status: 'sent', messageId };
      } catch (error: any) {
        console.error(`Email send failed for ${emailLogId}:`, error.message);

        if (!error.message.startsWith('RATE_LIMIT:')) {
          await query(
            "UPDATE email_logs SET status = 'failed', error_message = $1 WHERE id = $2",
            [error.message.substring(0, 500), emailLogId]
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
