import { Router, Request, Response } from 'express';
import { query } from '../config/database';
import { authMiddleware } from '../middleware/auth';
import { parsePagination } from '../utils/pagination';

const router = Router();
router.use(authMiddleware);

// Workspace activity feed
router.get('/', async (req: Request, res: Response) => {
  try {
    const wsId = req.user!.workspaceId;
    const { page, limit, offset } = parsePagination(req);
    const action = req.query.action as string;
    const contactId = req.query.contact_id as string;
    const sequenceId = req.query.sequence_id as string;

    let where = 'WHERE al.workspace_id = $1';
    const params: any[] = [wsId];
    let idx = 2;

    if (action) { where += ` AND al.action = $${idx++}`; params.push(action); }
    if (contactId) { where += ` AND al.contact_id = $${idx++}`; params.push(contactId); }
    if (sequenceId) { where += ` AND al.sequence_id = $${idx++}`; params.push(sequenceId); }

    const countRes = await query(`SELECT COUNT(*) FROM activity_log al ${where}`, params);
    const total = parseInt(countRes.rows[0].count);

    const data = await query(
      `SELECT al.*, c.email AS contact_email, c.first_name, c.last_name,
        s.name AS sequence_name, u.name AS user_name
       FROM activity_log al
       LEFT JOIN contacts c ON c.id = al.contact_id
       LEFT JOIN sequences s ON s.id = al.sequence_id
       LEFT JOIN users u ON u.id = al.user_id
       ${where}
       ORDER BY al.created_at DESC
       LIMIT $${idx++} OFFSET $${idx}`,
      [...params, limit, offset]
    );

    res.json({ data: data.rows, total, page, limit, totalPages: Math.ceil(total / limit) });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to fetch activity' });
  }
});

// Contact timeline
router.get('/contact/:contactId', async (req: Request, res: Response) => {
  try {
    const wsId = req.user!.workspaceId;
    const contactId = req.params.contactId;
    const limit = Math.min(100, parseInt(req.query.limit as string) || 50);

    const result = await query(
      `SELECT al.*, s.name AS sequence_name, u.name AS user_name
       FROM activity_log al
       LEFT JOIN sequences s ON s.id = al.sequence_id
       LEFT JOIN users u ON u.id = al.user_id
       WHERE al.workspace_id = $1 AND al.contact_id = $2
       ORDER BY al.created_at DESC
       LIMIT $3`,
      [wsId, contactId, limit]
    );

    res.json({ activity: result.rows });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to fetch contact timeline' });
  }
});

export default router;
