import { Router, Request, Response } from 'express';
import { query } from '../config/database';
import { authMiddleware } from '../middleware/auth';

const router = Router();
router.use(authMiddleware);

// Dashboard overview
router.get('/overview', async (req: Request, res: Response) => {
  try {
    const wsId = req.user!.workspaceId;

    const [contacts, campaigns, sequences, emails, recentActivity] = await Promise.all([
      query(
        `SELECT
          COUNT(*) AS total,
          COUNT(*) FILTER (WHERE status = 'active') AS active,
          COUNT(*) FILTER (WHERE status = 'unsubscribed') AS unsubscribed,
          COUNT(*) FILTER (WHERE status = 'bounced') AS bounced
         FROM contacts WHERE workspace_id = $1`,
        [wsId]
      ),
      query(
        `SELECT
          COUNT(*) AS total,
          COUNT(*) FILTER (WHERE status = 'sending') AS sending,
          COUNT(*) FILTER (WHERE status = 'completed') AS completed
         FROM campaigns WHERE workspace_id = $1`,
        [wsId]
      ),
      query(
        `SELECT
          COUNT(*) AS total,
          COUNT(*) FILTER (WHERE status = 'active') AS active,
          (SELECT COUNT(*) FROM sequence_enrollments WHERE workspace_id = $1 AND status = 'active') AS active_enrollments
         FROM sequences WHERE workspace_id = $1`,
        [wsId]
      ),
      query(
        `SELECT
          COUNT(*) AS total_sent,
          COUNT(*) FILTER (WHERE opened_at IS NOT NULL) AS total_opened,
          COUNT(*) FILTER (WHERE clicked_at IS NOT NULL) AS total_clicked,
          COUNT(*) FILTER (WHERE replied_at IS NOT NULL) AS total_replied,
          COUNT(*) FILTER (WHERE status = 'bounced') AS total_bounced,
          CASE WHEN COUNT(*) > 0 THEN ROUND(COUNT(*) FILTER (WHERE opened_at IS NOT NULL)::numeric / COUNT(*)::numeric * 100, 1) ELSE 0 END AS open_rate,
          CASE WHEN COUNT(*) > 0 THEN ROUND(COUNT(*) FILTER (WHERE clicked_at IS NOT NULL)::numeric / COUNT(*)::numeric * 100, 1) ELSE 0 END AS click_rate,
          CASE WHEN COUNT(*) > 0 THEN ROUND(COUNT(*) FILTER (WHERE replied_at IS NOT NULL)::numeric / COUNT(*)::numeric * 100, 1) ELSE 0 END AS reply_rate
         FROM email_logs WHERE workspace_id = $1 AND status != 'queued'`,
        [wsId]
      ),
      query(
        `SELECT ee.event_type, ee.occurred_at, el.to_email, el.subject
         FROM email_events ee
         JOIN email_logs el ON el.id = ee.email_log_id
         WHERE ee.workspace_id = $1
         ORDER BY ee.occurred_at DESC LIMIT 20`,
        [wsId]
      ),
    ]);

    res.json({
      contacts: contacts.rows[0],
      campaigns: campaigns.rows[0],
      sequences: sequences.rows[0],
      emails: emails.rows[0],
      recentActivity: recentActivity.rows,
    });
  } catch (err: any) {
    console.error('Analytics overview error:', err);
    res.status(500).json({ error: 'Failed to fetch analytics' });
  }
});

// Daily send volume (last 30 days)
router.get('/timeline', async (req: Request, res: Response) => {
  try {
    const wsId = req.user!.workspaceId;
    const days = parseInt(req.query.days as string) || 30;

    const result = await query(
      `SELECT
        DATE(sent_at) AS date,
        COUNT(*) AS sent,
        COUNT(*) FILTER (WHERE opened_at IS NOT NULL) AS opened,
        COUNT(*) FILTER (WHERE clicked_at IS NOT NULL) AS clicked,
        COUNT(*) FILTER (WHERE replied_at IS NOT NULL) AS replied,
        COUNT(*) FILTER (WHERE status = 'bounced') AS bounced
       FROM email_logs
       WHERE workspace_id = $1 AND sent_at >= NOW() - INTERVAL '1 day' * $2
       GROUP BY DATE(sent_at) ORDER BY date ASC`,
      [wsId, days]
    );

    res.json({ timeline: result.rows });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to fetch timeline' });
  }
});

// Tone breakdown
router.get('/tone-breakdown', async (req: Request, res: Response) => {
  try {
    const wsId = req.user!.workspaceId;

    const result = await query(
      `SELECT
        detected_tone AS tone,
        COUNT(*) AS count
       FROM reply_messages
       WHERE workspace_id = $1 AND detected_tone IS NOT NULL
       GROUP BY detected_tone ORDER BY count DESC`,
      [wsId]
    );

    res.json({ toneBreakdown: result.rows });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to fetch tone breakdown' });
  }
});

// Recent replies
router.get('/replies', async (req: Request, res: Response) => {
  try {
    const wsId = req.user!.workspaceId;
    const limit = Math.min(50, parseInt(req.query.limit as string) || 20);

    const result = await query(
      `SELECT rm.*, c.first_name, c.last_name, c.company
       FROM reply_messages rm
       LEFT JOIN contacts c ON c.id = rm.contact_id
       WHERE rm.workspace_id = $1
       ORDER BY rm.created_at DESC LIMIT $2`,
      [wsId, limit]
    );

    res.json({ replies: result.rows });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to fetch replies' });
  }
});

export default router;
