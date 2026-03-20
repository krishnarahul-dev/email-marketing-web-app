import { Router, Request, Response } from 'express';
import path from 'path';
import { query, transaction } from '../config/database';
import { verifyUnsubscribeToken } from '../utils/unsubscribe';
import { verifyLinkSignature } from '../utils/tracking';
import { cancelEnrollmentJobs } from '../services/queueService';
import { config } from '../config';

const router = Router();

// 1x1 transparent GIF pixel (pre-generated)
const PIXEL_GIF = Buffer.from(
  'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
  'base64'
);

// Open tracking pixel
router.get('/track/open', async (req: Request, res: Response) => {
  try {
    const lid = req.query.lid as string;
    if (!lid) {
      res.set('Content-Type', 'image/gif');
      res.send(PIXEL_GIF);
      return;
    }

    // Non-blocking update
    setImmediate(async () => {
      try {
        await query(
          `UPDATE email_logs SET
            status = CASE WHEN status IN ('sent','delivered') THEN 'opened' ELSE status END,
            opened_at = COALESCE(opened_at, NOW()),
            open_count = open_count + 1
           WHERE id = $1`,
          [lid]
        );

        const log = await query('SELECT workspace_id FROM email_logs WHERE id = $1', [lid]);
        if (log.rows.length > 0) {
          await query(
            `INSERT INTO email_events (email_log_id, workspace_id, event_type, ip_address, user_agent)
             VALUES ($1, $2, 'opened', $3, $4)`,
            [lid, log.rows[0].workspace_id, req.ip, req.headers['user-agent'] || '']
          );
        }
      } catch (err) {
        console.error('Open tracking error:', err);
      }
    });

    res.set({
      'Content-Type': 'image/gif',
      'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
      'Pragma': 'no-cache',
      'Expires': '0',
    });
    res.send(PIXEL_GIF);
  } catch (err) {
    res.set('Content-Type', 'image/gif');
    res.send(PIXEL_GIF);
  }
});

// Click tracking redirect
router.get('/track/click', async (req: Request, res: Response) => {
  try {
    const lid = req.query.lid as string;
    const url = req.query.url as string;
    const sig = req.query.sig as string;

    if (!lid || !url) {
      res.status(400).send('Missing parameters');
      return;
    }

    // Verify signature to prevent open redirect
    if (!sig || !verifyLinkSignature(lid, url, sig)) {
      res.status(403).send('Invalid signature');
      return;
    }

    // Validate URL
    try {
      const parsed = new URL(url);
      if (!['http:', 'https:'].includes(parsed.protocol)) {
        res.status(400).send('Invalid URL protocol');
        return;
      }
    } catch {
      res.status(400).send('Invalid URL');
      return;
    }

    // Non-blocking update
    setImmediate(async () => {
      try {
        await query(
          `UPDATE email_logs SET
            status = CASE WHEN status IN ('sent','delivered','opened') THEN 'clicked' ELSE status END,
            clicked_at = COALESCE(clicked_at, NOW()),
            click_count = click_count + 1
           WHERE id = $1`,
          [lid]
        );

        const log = await query('SELECT workspace_id FROM email_logs WHERE id = $1', [lid]);
        if (log.rows.length > 0) {
          await query(
            `INSERT INTO email_events (email_log_id, workspace_id, event_type, ip_address, user_agent, link_url)
             VALUES ($1, $2, 'clicked', $3, $4, $5)`,
            [lid, log.rows[0].workspace_id, req.ip, req.headers['user-agent'] || '', url]
          );
        }
      } catch (err) {
        console.error('Click tracking error:', err);
      }
    });

    res.redirect(302, url);
  } catch (err) {
    console.error('Click redirect error:', err);
    res.status(500).send('Redirect failed');
  }
});

// Unsubscribe
router.get('/unsubscribe', async (req: Request, res: Response) => {
  try {
    const token = req.query.token as string;
    if (!token) {
      res.status(400).send(renderUnsubscribePage('Invalid unsubscribe link.', true));
      return;
    }

    let payload;
    try {
      payload = verifyUnsubscribeToken(token);
    } catch {
      res.status(400).send(renderUnsubscribePage('This unsubscribe link has expired or is invalid.', true));
      return;
    }

    await transaction(async (client) => {
      // Update contact status
      await client.query(
        "UPDATE contacts SET status = 'unsubscribed' WHERE id = $1 AND workspace_id = $2",
        [payload.contactId, payload.workspaceId]
      );

      // Get contact email for suppression
      const contact = await client.query('SELECT email FROM contacts WHERE id = $1', [payload.contactId]);
      if (contact.rows.length > 0) {
        await client.query(
          `INSERT INTO suppression_list (workspace_id, email, reason, source)
           VALUES ($1, $2, 'unsubscribe', 'user_action')
           ON CONFLICT (workspace_id, email) DO NOTHING`,
          [payload.workspaceId, contact.rows[0].email]
        );
      }

      // Cancel all active enrollments
      const enrollments = await client.query(
        "SELECT id FROM sequence_enrollments WHERE contact_id = $1 AND workspace_id = $2 AND status = 'active'",
        [payload.contactId, payload.workspaceId]
      );

      for (const e of enrollments.rows) {
        await cancelEnrollmentJobs(e.id);
        await client.query(
          "UPDATE sequence_enrollments SET status = 'unsubscribed' WHERE id = $1",
          [e.id]
        );
      }

      // Log event
      if (payload.emailLogId) {
        await client.query(
          `INSERT INTO email_events (email_log_id, workspace_id, event_type, ip_address, user_agent)
           VALUES ($1, $2, 'unsubscribed', $3, $4)`,
          [payload.emailLogId, payload.workspaceId, req.ip, req.headers['user-agent'] || '']
        );
      }
    });

    res.send(renderUnsubscribePage('You have been successfully unsubscribed. You will no longer receive emails from us.', false));
  } catch (err: any) {
    console.error('Unsubscribe error:', err);
    res.status(500).send(renderUnsubscribePage('An error occurred. Please try again later.', true));
  }
});

function renderUnsubscribePage(message: string, isError: boolean): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Unsubscribe</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; display: flex; justify-content: center; align-items: center; min-height: 100vh; margin: 0; background: #f5f5f5; }
    .card { background: white; padding: 40px; border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); text-align: center; max-width: 480px; }
    .icon { font-size: 48px; margin-bottom: 16px; }
    h1 { font-size: 24px; margin: 0 0 12px; color: #1a1a1a; }
    p { color: #666; font-size: 16px; line-height: 1.5; }
    .error p { color: #dc3545; }
  </style>
</head>
<body>
  <div class="card ${isError ? 'error' : ''}">
    <div class="icon">${isError ? '⚠️' : '✓'}</div>
    <h1>${isError ? 'Oops' : 'Unsubscribed'}</h1>
    <p>${message}</p>
  </div>
</body>
</html>`;
}

export default router;
