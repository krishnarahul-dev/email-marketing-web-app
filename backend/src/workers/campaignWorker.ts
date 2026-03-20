import { Worker, Job } from 'bullmq';
import { createRedisConnection } from '../config/redis';
import { query } from '../config/database';
import { scheduleEmailSend, CampaignJobData } from '../services/queueService';
import { buildPersonalizationData, personalizeContent, personalizeSubject } from '../utils/personalization';
import { injectUnsubscribeLink } from '../utils/unsubscribe';
import { prepareEmailForSending } from '../utils/tracking';
import { config } from '../config';

export function startCampaignWorker(): Worker {
  const worker = new Worker<CampaignJobData>(
    'campaign-sender',
    async (job: Job<CampaignJobData>) => {
      const { campaignId, workspaceId } = job.data;

      try {
        // Load campaign
        const campaignRes = await query(
          'SELECT * FROM campaigns WHERE id = $1 AND workspace_id = $2',
          [campaignId, workspaceId]
        );
        if (campaignRes.rows.length === 0) throw new Error('Campaign not found');
        const campaign = campaignRes.rows[0];

        // Load template
        if (!campaign.template_id) throw new Error('Campaign has no template');
        const templateRes = await query(
          'SELECT * FROM templates WHERE id = $1',
          [campaign.template_id]
        );
        if (templateRes.rows.length === 0) throw new Error('Template not found');
        const template = templateRes.rows[0];

        // Load workspace
        const wsRes = await query('SELECT * FROM workspaces WHERE id = $1', [workspaceId]);
        const workspace = wsRes.rows[0];

        // Get queued email logs
        const emailLogs = await query(
          "SELECT el.*, c.first_name, c.last_name, c.company, c.title, c.email AS contact_email, c.custom_fields FROM email_logs el JOIN contacts c ON c.id = el.contact_id WHERE el.campaign_id = $1 AND el.status = 'queued' ORDER BY el.created_at ASC",
          [campaignId]
        );

        let processed = 0;
        const batchSize = config.email.maxBatchSize;

        for (const log of emailLogs.rows) {
          // Check suppression
          const suppressed = await query(
            'SELECT id FROM suppression_list WHERE workspace_id = $1 AND email = $2',
            [workspaceId, log.contact_email]
          );
          if (suppressed.rows.length > 0) {
            await query("UPDATE email_logs SET status = 'failed', error_message = 'Suppressed' WHERE id = $1", [log.id]);
            continue;
          }

          // Personalize
          const pData = buildPersonalizationData({
            email: log.contact_email,
            first_name: log.first_name,
            last_name: log.last_name,
            company: log.company,
            title: log.title,
            custom_fields: log.custom_fields,
          });

          const subject = personalizeSubject(campaign.subject || template.subject || '', pData);
          let html = personalizeContent(template.html_content || '', pData);
          html = injectUnsubscribeLink(html, log.contact_id, workspaceId, log.id);
          html = prepareEmailForSending(html, log.id, log.contact_id, workspaceId);

          // Update log with personalized content
          await query('UPDATE email_logs SET subject = $1, html_content = $2 WHERE id = $3', [subject, html, log.id]);

          // Queue for sending with small stagger delay
          const staggerDelay = Math.floor(processed / batchSize) * 60000; // 1 minute per batch
          await scheduleEmailSend(
            {
              emailLogId: log.id,
              workspaceId,
              contactId: log.contact_id,
              to: log.contact_email,
              from: workspace.ses_from_email,
              fromName: workspace.ses_from_name,
              subject,
              htmlBody: html,
              configurationSet: workspace.ses_config_set || undefined,
            },
            staggerDelay
          );

          processed++;
          await job.updateProgress(Math.round((processed / emailLogs.rows.length) * 100));
        }

        // Mark campaign as completed if all processed
        await query(
          "UPDATE campaigns SET status = 'completed', total_recipients = $1 WHERE id = $2",
          [processed, campaignId]
        );

        return { status: 'completed', processed };
      } catch (error: any) {
        console.error(`Campaign send failed for ${campaignId}:`, error.message);
        await query("UPDATE campaigns SET status = 'paused' WHERE id = $1", [campaignId]);
        throw error;
      }
    },
    {
      connection: createRedisConnection(),
      concurrency: 2,
    }
  );

  worker.on('completed', (job) => {
    console.log(`Campaign job ${job.id} completed`);
  });

  worker.on('failed', (job, err) => {
    console.error(`Campaign job ${job?.id} failed:`, err.message);
  });

  console.log('Campaign worker started');
  return worker;
}
