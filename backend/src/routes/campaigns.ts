import { Router, Request, Response } from 'express';
import { query, transaction } from '../config/database';
import { authMiddleware } from '../middleware/auth';
import { validate } from '../middleware/validation';
import { parsePagination } from '../utils/pagination';
import { scheduleCampaignSend } from '../services/queueService';
import { Campaign } from '../types';

const router = Router();
router.use(authMiddleware);

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

router.put('/:id', async (req: Request, res: Response) => {
  try {
    const { name, subject, template_id, send_at, status } = req.body;
    const result = await query<Campaign>(
      `UPDATE campaigns SET
        name = COALESCE($1, name),
        subject = COALESCE($2, subject),
        template_id = COALESCE($3, template_id),
        send_at = COALESCE($4, send_at),
        status = COALESCE($5, status)
       WHERE id = $6 AND workspace_id = $7 AND status IN ('draft','paused') RETURNING *`,
      [name, subject, template_id, send_at, status, req.params.id, req.user!.workspaceId]
    );
    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Campaign not found or cannot be edited' });
      return;
    }
    res.json({ campaign: result.rows[0] });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to update campaign' });
  }
});

router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const result = await query(
      "DELETE FROM campaigns WHERE id = $1 AND workspace_id = $2 AND status = 'draft' RETURNING id",
      [req.params.id, req.user!.workspaceId]
    );
    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Campaign not found or cannot be deleted' });
      return;
    }
    res.json({ deleted: true });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to delete campaign' });
  }
});

// Add recipients to campaign
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
      res.status(404).json({ error: 'Campaign not found or not in draft status' });
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

    // Update recipient count
    await query('UPDATE campaigns SET total_recipients = $1 WHERE id = $2', [ids.length, campaignId]);

    // Store recipient list in metadata (for campaign worker)
    await query(
      `UPDATE campaigns SET updated_at = NOW() WHERE id = $1`,
      [campaignId]
    );

    // Create email log placeholders
    const ws = await query('SELECT ses_from_email FROM workspaces WHERE id = $1', [wsId]);
    const fromEmail = ws.rows[0]?.ses_from_email || 'noreply@example.com';

    let created = 0;
    await transaction(async (client) => {
      for (const cid of ids) {
        const contact = await client.query('SELECT email FROM contacts WHERE id = $1', [cid]);
        if (contact.rows.length === 0) continue;

        await client.query(
          `INSERT INTO email_logs (workspace_id, contact_id, campaign_id, from_email, to_email, status)
           VALUES ($1,$2,$3,$4,$5,'queued')
           ON CONFLICT DO NOTHING`,
          [wsId, cid, campaignId, fromEmail, contact.rows[0].email]
        );
        created++;
      }
    });

    res.json({ recipients: created });
  } catch (err: any) {
    console.error('Add recipients error:', err);
    res.status(500).json({ error: 'Failed to add recipients' });
  }
});

// Send campaign
router.post('/:id/send', async (req: Request, res: Response) => {
  try {
    const wsId = req.user!.workspaceId;
    const campaignId = req.params.id;

    const campaign = await query<Campaign>(
      "SELECT * FROM campaigns WHERE id = $1 AND workspace_id = $2 AND status IN ('draft','paused')",
      [campaignId, wsId]
    );
    if (campaign.rows.length === 0) {
      res.status(404).json({ error: 'Campaign not found or already sent' });
      return;
    }

    if (!campaign.rows[0].template_id) {
      res.status(400).json({ error: 'Campaign must have a template before sending' });
      return;
    }

    const recipientCount = await query(
      "SELECT COUNT(*) FROM email_logs WHERE campaign_id = $1 AND status = 'queued'",
      [campaignId]
    );
    if (parseInt(recipientCount.rows[0].count) === 0) {
      res.status(400).json({ error: 'No recipients queued for this campaign' });
      return;
    }

    await query("UPDATE campaigns SET status = 'sending' WHERE id = $1", [campaignId]);

    await scheduleCampaignSend({ campaignId, workspaceId: wsId });

    res.json({ message: 'Campaign sending started', campaignId });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to start campaign' });
  }
});

// Campaign stats
router.get('/:id/stats', async (req: Request, res: Response) => {
  try {
    const result = await query(
      `SELECT
        COUNT(*) FILTER (WHERE status != 'queued') AS sent,
        COUNT(*) FILTER (WHERE opened_at IS NOT NULL) AS opened,
        COUNT(*) FILTER (WHERE clicked_at IS NOT NULL) AS clicked,
        COUNT(*) FILTER (WHERE replied_at IS NOT NULL) AS replied,
        COUNT(*) FILTER (WHERE status = 'bounced') AS bounced,
        COUNT(*) FILTER (WHERE status = 'complained') AS complained,
        COUNT(*) AS total
       FROM email_logs WHERE campaign_id = $1 AND workspace_id = $2`,
      [req.params.id, req.user!.workspaceId]
    );

    res.json({ stats: result.rows[0] });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

export default router;
