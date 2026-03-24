import { Router, Request, Response } from 'express';
import { query, transaction } from '../config/database';
import { authMiddleware } from '../middleware/auth';
import { validate } from '../middleware/validation';
import { parsePagination } from '../utils/pagination';
import { scheduleCampaignSend } from '../services/queueService';
import { config } from '../config';
import { Campaign } from '../types';

const router = Router();
router.use(authMiddleware);

// List campaigns
router.get('/', async (req: Request, res: Response) => {
  try {
    const wsId = req.user!.workspaceId;
    const { page, limit, offset } = parsePagination(req);
    const status = req.query.status as string;

    let where = 'WHERE workspace_id = $1';
    const params: any[] = [wsId];
    let idx = 2;

    if (status) {
      where += ` AND status = $${idx++}`;
      params.push(status);
    }

    const countRes = await query(`SELECT COUNT(*) FROM campaigns ${where}`, params);
    const total = parseInt(countRes.rows[0].count);

    const dataRes = await query<Campaign>(
      `SELECT * FROM campaigns ${where} ORDER BY created_at DESC LIMIT $${idx++} OFFSET $${idx}`,
      [...params, limit, offset]
    );

    res.json({ data: dataRes.rows, total, page, limit, totalPages: Math.ceil(total / limit) });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to fetch campaigns' });
  }
});

// Get single campaign
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const result = await query<Campaign>(
      'SELECT * FROM campaigns WHERE id = $1 AND workspace_id = $2',
      [req.params.id, req.user!.workspaceId]
    );
    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Campaign not found' });
      return;
    }
    res.json({ campaign: result.rows[0] });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to fetch campaign' });
  }
});

// Create campaign
router.post(
  '/',
  validate([
    { field: 'name', required: true, type: 'string', minLength: 1, maxLength: 255 },
  ]),
  async (req: Request, res: Response) => {
    try {
      const { name, subject, template_id, send_at } = req.body;
      const result = await query<Campaign>(
        `INSERT INTO campaigns (workspace_id, name, subject, template_id, send_at, created_by)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
        [req.user!.workspaceId, name, subject || null, template_id || null, send_at || null, req.user!.userId]
      );
      res.status(201).json({ campaign: result.rows[0] });
    } catch (err: any) {
      res.status(500).json({ error: 'Failed to create campaign' });
    }
  }
);

// Update campaign (draft and paused only)
router.put('/:id', async (req: Request, res: Response) => {
  try {
    const { name, subject, template_id, send_at } = req.body;
    const result = await query<Campaign>(
      `UPDATE campaigns SET
        name = COALESCE($1, name),
        subject = COALESCE($2, subject),
        template_id = COALESCE($3, template_id),
        send_at = COALESCE($4, send_at)
       WHERE id = $5 AND workspace_id = $6 AND status IN ('draft','paused') RETURNING *`,
      [name, subject, template_id, send_at, req.params.id, req.user!.workspaceId]
    );
    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Campaign not found or cannot be edited in its current status' });
      return;
    }
    res.json({ campaign: result.rows[0] });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to update campaign' });
  }
});

// Delete campaign (draft only)
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const result = await query(
      "DELETE FROM campaigns WHERE id = $1 AND workspace_id = $2 AND status = 'draft' RETURNING id",
      [req.params.id, req.user!.workspaceId]
    );
    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Campaign not found or cannot be deleted (must be in draft status)' });
      return;
    }
    res.json({ deleted: true });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to delete campaign' });
  }
});

// ════════════════════════════════════════════════════════════
// RESET CAMPAIGN — move any status back to draft
// ════════════════════════════════════════════════════════════
router.post('/:id/reset', async (req: Request, res: Response) => {
  try {
    const wsId = req.user!.workspaceId;
    const campaignId = req.params.id;

    const campaign = await query(
      'SELECT id, status FROM campaigns WHERE id = $1 AND workspace_id = $2',
      [campaignId, wsId]
    );
    if (campaign.rows.length === 0) {
      res.status(404).json({ error: 'Campaign not found' });
      return;
    }

    const currentStatus = campaign.rows[0].status;
    if (currentStatus === 'draft') {
      res.json({ message: 'Campaign is already in draft status', campaign: campaign.rows[0] });
      return;
    }

    await transaction(async (client) => {
      // Reset campaign to draft
      await client.query(
        `UPDATE campaigns SET
          status = 'draft',
          sent_count = 0,
          open_count = 0,
          click_count = 0,
          reply_count = 0,
          bounce_count = 0,
          updated_at = NOW()
         WHERE id = $1`,
        [campaignId]
      );

      // Delete all email logs for this campaign (so recipients can be re-added)
      await client.query(
        'DELETE FROM email_logs WHERE campaign_id = $1',
        [campaignId]
      );

      // Update total_recipients to 0
      await client.query(
        'UPDATE campaigns SET total_recipients = 0 WHERE id = $1',
        [campaignId]
      );
    });

    const updated = await query('SELECT * FROM campaigns WHERE id = $1', [campaignId]);
    res.json({
      message: `Campaign reset from "${currentStatus}" to "draft"`,
      campaign: updated.rows[0],
    });
  } catch (err: any) {
    console.error('Reset campaign error:', err);
    res.status(500).json({ error: 'Failed to reset campaign' });
  }
});

// ════════════════════════════════════════════════════════════
// PAUSE CAMPAIGN — stop a sending campaign
// ════════════════════════════════════════════════════════════
router.post('/:id/pause', async (req: Request, res: Response) => {
  try {
    const result = await query(
      `UPDATE campaigns SET status = 'paused', updated_at = NOW()
       WHERE id = $1 AND workspace_id = $2 AND status = 'sending' RETURNING *`,
      [req.params.id, req.user!.workspaceId]
    );
    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Campaign not found or not currently sending' });
      return;
    }
    res.json({ message: 'Campaign paused', campaign: result.rows[0] });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to pause campaign' });
  }
});

// ════════════════════════════════════════════════════════════
// ADD RECIPIENTS
// ════════════════════════════════════════════════════════════
router.post('/:id/recipients', async (req: Request, res: Response) => {
  try {
    const { contactIds, filter } = req.body;
    const wsId = req.user!.workspaceId;
    const campaignId = req.params.id;

    // Verify campaign exists and is draft
    const campaign = await query(
      "SELECT id FROM campaigns WHERE id = $1 AND workspace_id = $2 AND status = 'draft'",
      [campaignId, wsId]
    );
    if (campaign.rows.length === 0) {
      res.status(404).json({ error: 'Campaign not found or not in draft status. Reset the campaign first.' });
      return;
    }

    let ids: string[] = contactIds || [];

    // If filter provided, query contacts
    if (filter) {
      let filterWhere = "WHERE workspace_id = $1 AND status = 'active'";
      const filterParams: any[] = [wsId];
      let fIdx = 2;

      if (filter.tags?.length) {
        filterWhere += ` AND tags && $${fIdx++}::text[]`;
        filterParams.push(filter.tags);
      }
      if (filter.source) {
        filterWhere += ` AND source = $${fIdx++}`;
        filterParams.push(filter.source);
      }

      // Exclude suppressed
      filterWhere += ` AND email NOT IN (SELECT email FROM suppression_list WHERE workspace_id = $1)`;

      const contactRes = await query(`SELECT id FROM contacts ${filterWhere}`, filterParams);
      ids = contactRes.rows.map((r: any) => r.id);
    }

    if (ids.length === 0) {
      res.status(400).json({ error: 'No eligible contacts found to add' });
      return;
    }

    // Get workspace from email
    const ws = await query('SELECT ses_from_email FROM workspaces WHERE id = $1', [wsId]);
    const fromEmail = ws.rows[0]?.ses_from_email || 'noreply@example.com';

    let created = 0;
    await transaction(async (client) => {
      // Remove any previously queued (unsent) logs for this campaign to prevent duplicates
      await client.query(
        "DELETE FROM email_logs WHERE campaign_id = $1 AND status = 'queued'",
        [campaignId]
      );

      for (const cid of ids) {
        const contact = await client.query('SELECT email FROM contacts WHERE id = $1', [cid]);
        if (contact.rows.length === 0) continue;

        await client.query(
          `INSERT INTO email_logs (workspace_id, contact_id, campaign_id, from_email, to_email, status)
           VALUES ($1,$2,$3,$4,$5,'queued')`,
          [wsId, cid, campaignId, fromEmail, contact.rows[0].email]
        );
        created++;
      }

      // Update campaign recipient count
      await client.query(
        'UPDATE campaigns SET total_recipients = $1, updated_at = NOW() WHERE id = $2',
        [created, campaignId]
      );
    });

    res.json({ recipients: created });
  } catch (err: any) {
    console.error('Add recipients error:', err);
    res.status(500).json({ error: 'Failed to add recipients' });
  }
});

// ════════════════════════════════════════════════════════════
// SEND CAMPAIGN
// ════════════════════════════════════════════════════════════
router.post('/:id/send', async (req: Request, res: Response) => {
  try {
    const wsId = req.user!.workspaceId;
    const campaignId = req.params.id;

    const campaign = await query<Campaign>(
      "SELECT * FROM campaigns WHERE id = $1 AND workspace_id = $2 AND status IN ('draft','paused')",
      [campaignId, wsId]
    );
    if (campaign.rows.length === 0) {
      res.status(404).json({
        error: 'Campaign not found or cannot be sent. If the campaign is stuck in "sending" or "completed", use the Reset button to return it to draft first.',
      });
      return;
    }

    if (!campaign.rows[0].template_id) {
      res.status(400).json({ error: 'Campaign must have a template before sending. Edit the campaign and assign a template.' });
      return;
    }

    // Check if workspace has a sending email configured
    const ws = await query('SELECT ses_from_email FROM workspaces WHERE id = $1', [wsId]);
    if (!ws.rows[0]?.ses_from_email) {
      res.status(400).json({
        error: 'No sending email configured. Go to Settings and set your SES sending email address first.',
      });
      return;
    }

    // Check SES credentials exist
    if (!config.ses.accessKeyId || config.ses.accessKeyId === 'AKIAIOSFODNN7EXAMPLE' || config.ses.accessKeyId.startsWith('AKIAXXXXXXXXX')) {
      res.status(400).json({
        error: 'AWS SES credentials are not configured. Set SES_ACCESS_KEY_ID and SES_SECRET_ACCESS_KEY in your environment variables with real AWS credentials.',
      });
      return;
    }

    const recipientCount = await query(
      "SELECT COUNT(*) FROM email_logs WHERE campaign_id = $1 AND status = 'queued'",
      [campaignId]
    );
    if (parseInt(recipientCount.rows[0].count) === 0) {
      res.status(400).json({ error: 'No recipients queued. Click "Add Recipients" to select contacts for this campaign.' });
      return;
    }

    await query("UPDATE campaigns SET status = 'sending' WHERE id = $1", [campaignId]);

    await scheduleCampaignSend({ campaignId, workspaceId: wsId });

    res.json({ message: 'Campaign sending started', campaignId });
  } catch (err: any) {
    console.error('Campaign send error:', err);
    res.status(500).json({ error: 'Failed to start campaign sending' });
  }
});

// ════════════════════════════════════════════════════════════
// CAMPAIGN STATS
// ════════════════════════════════════════════════════════════
router.get('/:id/stats', async (req: Request, res: Response) => {
  try {
    const result = await query(
      `SELECT
        COUNT(*) FILTER (WHERE status NOT IN ('queued')) AS sent,
        COUNT(*) FILTER (WHERE opened_at IS NOT NULL) AS opened,
        COUNT(*) FILTER (WHERE clicked_at IS NOT NULL) AS clicked,
        COUNT(*) FILTER (WHERE replied_at IS NOT NULL) AS replied,
        COUNT(*) FILTER (WHERE status = 'bounced') AS bounced,
        COUNT(*) FILTER (WHERE status = 'complained') AS complained,
        COUNT(*) FILTER (WHERE status = 'failed') AS failed,
        COUNT(*) FILTER (WHERE status = 'queued') AS queued,
        COUNT(*) AS total
       FROM email_logs WHERE campaign_id = $1 AND workspace_id = $2`,
      [req.params.id, req.user!.workspaceId]
    );

    // Also get error messages if any failed
    const errors = await query(
      `SELECT error_message, COUNT(*) AS count
       FROM email_logs WHERE campaign_id = $1 AND status = 'failed' AND error_message IS NOT NULL
       GROUP BY error_message ORDER BY count DESC LIMIT 5`,
      [req.params.id]
    );

    res.json({ stats: result.rows[0], errors: errors.rows });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

export default router;
