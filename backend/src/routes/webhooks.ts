import { Router, Request, Response } from 'express';
import { query } from '../config/database';
import { scheduleReplyProcess } from '../services/queueService';
import { config } from '../config';
import { v4 as uuidv4 } from 'uuid';

const router = Router();

// Postmark inbound webhook - no auth middleware (webhook endpoint)
router.post('/inbound', async (req: Request, res: Response) => {
  try {
    const payload = req.body;

    // Basic webhook verification
    const token = req.headers['x-postmark-token'] || req.query.token;
    if (config.postmark.webhookToken && token !== config.postmark.webhookToken) {
      res.status(401).json({ error: 'Invalid webhook token' });
      return;
    }

    const fromEmail = (payload.FromFull?.Email || payload.From || '').toLowerCase().trim();
    const subject = payload.Subject || '';
    const textBody = payload.TextBody || '';
    const htmlBody = payload.HtmlBody || '';
    const headers = payload.Headers || [];
    const messageId = payload.MessageID || '';

    if (!fromEmail) {
      res.status(400).json({ error: 'Missing sender email' });
      return;
    }

    // Find matching contact across workspaces
    const contactResult = await query(
      "SELECT c.*, w.id AS ws_id FROM contacts c JOIN workspaces w ON w.id = c.workspace_id WHERE c.email = $1 AND c.status = 'active' LIMIT 1",
      [fromEmail]
    );

    if (contactResult.rows.length === 0) {
      // Unknown sender — log but don't process
      console.log(`Inbound email from unknown sender: ${fromEmail}`);
      res.status(200).json({ received: true, matched: false });
      return;
    }

    const contact = contactResult.rows[0];
    const workspaceId = contact.ws_id;

    // Find the most recent outbound email to this contact
    const emailLogResult = await query(
      `SELECT el.* FROM email_logs el
       WHERE el.contact_id = $1 AND el.workspace_id = $2 AND el.status != 'failed'
       ORDER BY el.sent_at DESC NULLS LAST LIMIT 1`,
      [contact.id, workspaceId]
    );

    const emailLog = emailLogResult.rows[0] || null;

    // Find active enrollment
    let enrollmentId = emailLog?.enrollment_id || null;
    if (!enrollmentId) {
      const enrollResult = await query(
        "SELECT id FROM sequence_enrollments WHERE contact_id = $1 AND workspace_id = $2 AND status = 'active' ORDER BY enrolled_at DESC LIMIT 1",
        [contact.id, workspaceId]
      );
      if (enrollResult.rows.length > 0) enrollmentId = enrollResult.rows[0].id;
    }

    // Store reply
    const replyId = uuidv4();
    await query(
      `INSERT INTO reply_messages (id, workspace_id, contact_id, email_log_id, enrollment_id, from_email, subject, body_text, body_html, raw_headers, postmark_message_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [
        replyId, workspaceId, contact.id, emailLog?.id || null, enrollmentId,
        fromEmail, subject, textBody, htmlBody, JSON.stringify(headers), messageId,
      ]
    );

    // Update email log if found
    if (emailLog) {
      await query(
        "UPDATE email_logs SET status = 'replied', replied_at = NOW() WHERE id = $1",
        [emailLog.id]
      );
      await query(
        `INSERT INTO email_events (email_log_id, workspace_id, event_type, event_data)
         VALUES ($1, $2, 'replied', $3)`,
        [emailLog.id, workspaceId, JSON.stringify({ from: fromEmail, subject })]
      );
    }

    // Queue for tone detection and sequence branching
    await scheduleReplyProcess({ replyMessageId: replyId, workspaceId });

    res.status(200).json({ received: true, matched: true, replyId });
  } catch (err: any) {
    console.error('Inbound webhook error:', err);
    res.status(500).json({ error: 'Failed to process inbound email' });
  }
});

// SES event webhook (SNS notifications)
router.post('/events', async (req: Request, res: Response) => {
  try {
    const body = req.body;

    // Handle SNS subscription confirmation
    if (body.Type === 'SubscriptionConfirmation') {
      console.log('SNS Subscription confirmation URL:', body.SubscribeURL);
      res.status(200).json({ confirmed: true });
      return;
    }

    // Handle SNS notification
    let message = body;
    if (body.Type === 'Notification' && body.Message) {
      message = JSON.parse(body.Message);
    }

    const eventType = message.eventType || message.notificationType;
    if (!eventType) {
      res.status(200).json({ skipped: true });
      return;
    }

    const mail = message.mail || {};
    const sesMessageId = mail.messageId;

    if (!sesMessageId) {
      res.status(200).json({ skipped: true, reason: 'no messageId' });
      return;
    }

    // Find email log
    const logResult = await query(
      'SELECT id, workspace_id, contact_id FROM email_logs WHERE ses_message_id = $1',
      [sesMessageId]
    );
    if (logResult.rows.length === 0) {
      res.status(200).json({ skipped: true, reason: 'no matching log' });
      return;
    }

    const log = logResult.rows[0];

    switch (eventType.toLowerCase()) {
      case 'delivery': {
        await query("UPDATE email_logs SET status = 'delivered', delivered_at = NOW() WHERE id = $1 AND status NOT IN ('opened','clicked','replied')", [log.id]);
        await query(
          "INSERT INTO email_events (email_log_id, workspace_id, event_type, event_data) VALUES ($1,$2,'delivered',$3)",
          [log.id, log.workspace_id, JSON.stringify(message.delivery || {})]
        );
        break;
      }

      case 'bounce': {
        const bounceType = message.bounce?.bounceType;
        await query("UPDATE email_logs SET status = 'bounced', bounced_at = NOW(), error_message = $1 WHERE id = $2", [
          `${bounceType}: ${message.bounce?.bounceSubType || 'unknown'}`,
          log.id,
        ]);
        await query(
          "INSERT INTO email_events (email_log_id, workspace_id, event_type, event_data) VALUES ($1,$2,'bounced',$3)",
          [log.id, log.workspace_id, JSON.stringify(message.bounce || {})]
        );

        // Add to suppression list on hard bounce
        if (bounceType === 'Permanent') {
          const contact = await query('SELECT email FROM contacts WHERE id = $1', [log.contact_id]);
          if (contact.rows.length > 0) {
            await query(
              `INSERT INTO suppression_list (workspace_id, email, reason, source)
               VALUES ($1, $2, 'bounce', 'ses_notification')
               ON CONFLICT (workspace_id, email) DO NOTHING`,
              [log.workspace_id, contact.rows[0].email]
            );
            await query("UPDATE contacts SET status = 'bounced' WHERE id = $1", [log.contact_id]);
          }

          // Cancel enrollments
          await query(
            "UPDATE sequence_enrollments SET status = 'bounced' WHERE contact_id = $1 AND workspace_id = $2 AND status = 'active'",
            [log.contact_id, log.workspace_id]
          );
        }
        break;
      }

      case 'complaint': {
        await query("UPDATE email_logs SET status = 'complained' WHERE id = $1", [log.id]);
        await query(
          "INSERT INTO email_events (email_log_id, workspace_id, event_type, event_data) VALUES ($1,$2,'complained',$3)",
          [log.id, log.workspace_id, JSON.stringify(message.complaint || {})]
        );

        const contact = await query('SELECT email FROM contacts WHERE id = $1', [log.contact_id]);
        if (contact.rows.length > 0) {
          await query(
            `INSERT INTO suppression_list (workspace_id, email, reason, source)
             VALUES ($1, $2, 'complaint', 'ses_notification')
             ON CONFLICT (workspace_id, email) DO NOTHING`,
            [log.workspace_id, contact.rows[0].email]
          );
          await query("UPDATE contacts SET status = 'complained' WHERE id = $1", [log.contact_id]);
        }

        await query(
          "UPDATE sequence_enrollments SET status = 'cancelled' WHERE contact_id = $1 AND workspace_id = $2 AND status = 'active'",
          [log.contact_id, log.workspace_id]
        );
        break;
      }

      default:
        console.log('Unhandled SES event type:', eventType);
    }

    res.status(200).json({ processed: true });
  } catch (err: any) {
    console.error('SES event webhook error:', err);
    res.status(500).json({ error: 'Failed to process event' });
  }
});

export default router;
