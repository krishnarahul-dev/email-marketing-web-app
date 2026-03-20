import { Worker, Job } from 'bullmq';
import { createRedisConnection } from '../config/redis';
import { query } from '../config/database';
import { detectTone } from '../services/toneService';
import { handleReplyForEnrollment } from '../services/sequenceEngine';
import { ReplyProcessJobData } from '../services/queueService';

export function startReplyProcessWorker(): Worker {
  const worker = new Worker<ReplyProcessJobData>(
    'reply-processor',
    async (job: Job<ReplyProcessJobData>) => {
      const { replyMessageId, workspaceId } = job.data;

      try {
        // Load reply
        const replyRes = await query(
          'SELECT * FROM reply_messages WHERE id = $1 AND workspace_id = $2',
          [replyMessageId, workspaceId]
        );
        if (replyRes.rows.length === 0) throw new Error('Reply not found');
        const reply = replyRes.rows[0];

        if (reply.processed) return { status: 'already_processed' };

        // Detect tone
        const replyText = reply.body_text || reply.body_html?.replace(/<[^>]+>/g, '') || '';
        const toneResult = await detectTone(replyText);

        // Update reply with tone
        await query(
          'UPDATE reply_messages SET detected_tone = $1, tone_confidence = $2, processed = TRUE WHERE id = $3',
          [toneResult.category, toneResult.confidence, replyMessageId]
        );

        // Handle unsubscribe intent
        if (toneResult.category === 'unsubscribe') {
          if (reply.contact_id) {
            await query("UPDATE contacts SET status = 'unsubscribed' WHERE id = $1", [reply.contact_id]);
            const contact = await query('SELECT email FROM contacts WHERE id = $1', [reply.contact_id]);
            if (contact.rows.length > 0) {
              await query(
                `INSERT INTO suppression_list (workspace_id, email, reason, source)
                 VALUES ($1, $2, 'unsubscribe', 'reply_detection')
                 ON CONFLICT (workspace_id, email) DO NOTHING`,
                [workspaceId, contact.rows[0].email]
              );
            }
          }
        }

        // Handle enrollment branching
        if (reply.enrollment_id) {
          await handleReplyForEnrollment(reply.enrollment_id, toneResult.category);
        }

        // Update campaign reply count
        if (reply.email_log_id) {
          const log = await query('SELECT campaign_id FROM email_logs WHERE id = $1', [reply.email_log_id]);
          if (log.rows[0]?.campaign_id) {
            await query(
              'UPDATE campaigns SET reply_count = reply_count + 1 WHERE id = $1',
              [log.rows[0].campaign_id]
            );
          }
        }

        console.log(`Reply ${replyMessageId} processed: tone=${toneResult.category}, confidence=${toneResult.confidence}`);
        return { status: 'processed', tone: toneResult };
      } catch (error: any) {
        console.error(`Reply processing failed for ${replyMessageId}:`, error.message);
        throw error;
      }
    },
    {
      connection: createRedisConnection(),
      concurrency: 5,
    }
  );

  worker.on('completed', (job) => {
    console.log(`Reply process job ${job.id} completed`);
  });

  worker.on('failed', (job, err) => {
    console.error(`Reply process job ${job?.id} failed:`, err.message);
  });

  console.log('Reply process worker started');
  return worker;
}
