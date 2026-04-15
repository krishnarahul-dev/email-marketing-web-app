import { Router, Request, Response } from 'express';
import { query } from '../config/database';
import { authMiddleware } from '../middleware/auth';
import { parsePagination } from '../utils/pagination';

const router = Router();
router.use(authMiddleware);

// List tasks
router.get('/', async (req: Request, res: Response) => {
  try {
    const wsId = req.user!.workspaceId;
    const { page, limit, offset } = parsePagination(req);
    const status = req.query.status as string;
    const assignee = req.query.assignee as string;
    const taskType = req.query.task_type as string;
    const priority = req.query.priority as string;

    let where = 'WHERE t.workspace_id = $1';
    const params: any[] = [wsId];
    let idx = 2;

    if (status) { where += ` AND t.status = $${idx++}`; params.push(status); }
    if (assignee === 'me') { where += ` AND t.assigned_to = $${idx++}`; params.push(req.user!.userId); }
    else if (assignee) { where += ` AND t.assigned_to = $${idx++}`; params.push(assignee); }
    if (taskType) { where += ` AND t.task_type = $${idx++}`; params.push(taskType); }
    if (priority) { where += ` AND t.priority = $${idx++}`; params.push(priority); }

    const countRes = await query(`SELECT COUNT(*) FROM tasks t ${where}`, params);
    const total = parseInt(countRes.rows[0].count);

    const data = await query(
      `SELECT t.*, c.email AS contact_email, c.first_name, c.last_name, c.company,
        c.phone, c.linkedin_url, c.title AS contact_title,
        s.name AS sequence_name, u.name AS assignee_name
       FROM tasks t
       JOIN contacts c ON c.id = t.contact_id
       LEFT JOIN sequences s ON s.id = t.sequence_id
       LEFT JOIN users u ON u.id = t.assigned_to
       ${where}
       ORDER BY
         CASE t.priority WHEN 'urgent' THEN 1 WHEN 'high' THEN 2 WHEN 'normal' THEN 3 ELSE 4 END,
         t.due_at ASC NULLS LAST
       LIMIT $${idx++} OFFSET $${idx}`,
      [...params, limit, offset]
    );

    res.json({ data: data.rows, total, page, limit, totalPages: Math.ceil(total / limit) });
  } catch (err: any) {
    console.error('List tasks error:', err);
    res.status(500).json({ error: 'Failed to fetch tasks' });
  }
});

// Get single task
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const result = await query(
      `SELECT t.*, c.email AS contact_email, c.first_name, c.last_name, c.company, c.phone, c.linkedin_url
       FROM tasks t JOIN contacts c ON c.id = t.contact_id
       WHERE t.id = $1 AND t.workspace_id = $2`,
      [req.params.id, req.user!.workspaceId]
    );
    if (result.rows.length === 0) { res.status(404).json({ error: 'Task not found' }); return; }
    res.json({ task: result.rows[0] });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to fetch task' });
  }
});

// Create task manually
router.post('/', async (req: Request, res: Response) => {
  try {
    const { contact_id, task_type, title, instructions, priority, due_at, assigned_to } = req.body;
    if (!contact_id || !task_type || !title) {
      res.status(400).json({ error: 'contact_id, task_type, and title are required' });
      return;
    }
    const result = await query(
      `INSERT INTO tasks (workspace_id, contact_id, task_type, title, instructions, priority, due_at, assigned_to)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [req.user!.workspaceId, contact_id, task_type, title, instructions || null, priority || 'normal', due_at || null, assigned_to || req.user!.userId]
    );
    res.status(201).json({ task: result.rows[0] });
  } catch (err: any) {
    console.error('Create task error:', err);
    res.status(500).json({ error: 'Failed to create task' });
  }
});

// Update task
router.put('/:id', async (req: Request, res: Response) => {
  try {
    const { title, instructions, priority, due_at, assigned_to, status } = req.body;
    const result = await query(
      `UPDATE tasks SET
         title = COALESCE($1, title),
         instructions = COALESCE($2, instructions),
         priority = COALESCE($3, priority),
         due_at = COALESCE($4, due_at),
         assigned_to = COALESCE($5, assigned_to),
         status = COALESCE($6, status)
       WHERE id = $7 AND workspace_id = $8 RETURNING *`,
      [title, instructions, priority, due_at, assigned_to, status, req.params.id, req.user!.workspaceId]
    );
    if (result.rows.length === 0) { res.status(404).json({ error: 'Task not found' }); return; }
    res.json({ task: result.rows[0] });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to update task' });
  }
});

// Complete task with outcome
router.post('/:id/complete', async (req: Request, res: Response) => {
  try {
    const { outcome, notes } = req.body;
    const result = await query(
      `UPDATE tasks SET status = 'completed', completed_at = NOW(),
         completion_outcome = $1, completion_notes = $2
       WHERE id = $3 AND workspace_id = $4 RETURNING *`,
      [outcome || null, notes || null, req.params.id, req.user!.workspaceId]
    );
    if (result.rows.length === 0) { res.status(404).json({ error: 'Task not found' }); return; }

    const task = result.rows[0];

    // Log activity
    await query(
      `INSERT INTO activity_log (workspace_id, user_id, contact_id, sequence_id, enrollment_id, action, description, metadata)
       VALUES ($1, $2, $3, $4, $5, 'task_completed', $6, $7)`,
      [
        req.user!.workspaceId, req.user!.userId, task.contact_id,
        task.sequence_id, task.enrollment_id,
        `Completed ${task.task_type} task: ${task.title}`,
        JSON.stringify({ outcome, notes }),
      ]
    );

    // If task is part of a sequence and outcome is positive, the sequence engine will pick it up
    res.json({ task });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to complete task' });
  }
});

// Skip task
router.post('/:id/skip', async (req: Request, res: Response) => {
  try {
    const { reason } = req.body;
    const result = await query(
      `UPDATE tasks SET status = 'skipped', completed_at = NOW(), completion_notes = $1
       WHERE id = $2 AND workspace_id = $3 RETURNING *`,
      [reason || 'Skipped by user', req.params.id, req.user!.workspaceId]
    );
    if (result.rows.length === 0) { res.status(404).json({ error: 'Task not found' }); return; }
    res.json({ task: result.rows[0] });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to skip task' });
  }
});

// Delete task
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    await query('DELETE FROM tasks WHERE id = $1 AND workspace_id = $2', [req.params.id, req.user!.workspaceId]);
    res.json({ deleted: true });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to delete task' });
  }
});

// Task summary for dashboard
router.get('/stats/summary', async (req: Request, res: Response) => {
  try {
    const result = await query(
      `SELECT
         COUNT(*) FILTER (WHERE status = 'pending') AS pending,
         COUNT(*) FILTER (WHERE status = 'pending' AND due_at < NOW()) AS overdue,
         COUNT(*) FILTER (WHERE status = 'pending' AND due_at::date = CURRENT_DATE) AS due_today,
         COUNT(*) FILTER (WHERE status = 'completed' AND completed_at::date = CURRENT_DATE) AS completed_today,
         COUNT(*) FILTER (WHERE assigned_to = $2 AND status = 'pending') AS my_pending
       FROM tasks WHERE workspace_id = $1`,
      [req.user!.workspaceId, req.user!.userId]
    );
    res.json({ summary: result.rows[0] });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to fetch task summary' });
  }
});

export default router;
