import { Router, Request, Response } from 'express';
import { query } from '../config/database';
import { authMiddleware } from '../middleware/auth';
import { validate } from '../middleware/validation';
import { parsePagination } from '../utils/pagination';
import { enrollContact, bulkEnroll } from '../services/sequenceEngine';
import { cancelEnrollmentJobs } from '../services/queueService';
import { Sequence, SequenceStep, SequenceEnrollment } from '../types';

const router = Router();
router.use(authMiddleware);

// List sequences
router.get('/', async (req: Request, res: Response) => {
  try {
    const wsId = req.user!.workspaceId;
    const { page, limit, offset } = parsePagination(req);

    const countRes = await query('SELECT COUNT(*) FROM sequences WHERE workspace_id = $1', [wsId]);
    const total = parseInt(countRes.rows[0].count);

    const dataRes = await query<Sequence>(
      `SELECT s.*,
        (SELECT COUNT(*) FROM sequence_enrollments se WHERE se.sequence_id = s.id) AS enrollment_count,
        (SELECT COUNT(*) FROM sequence_enrollments se WHERE se.sequence_id = s.id AND se.status = 'active') AS active_enrollments,
        (SELECT COUNT(*) FROM sequence_steps ss WHERE ss.sequence_id = s.id) AS step_count
       FROM sequences s WHERE s.workspace_id = $1 ORDER BY s.created_at DESC LIMIT $2 OFFSET $3`,
      [wsId, limit, offset]
    );

    res.json({ data: dataRes.rows, total, page, limit, totalPages: Math.ceil(total / limit) });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to fetch sequences' });
  }
});

// Get sequence with steps
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const seqRes = await query<Sequence>(
      'SELECT * FROM sequences WHERE id = $1 AND workspace_id = $2',
      [req.params.id, req.user!.workspaceId]
    );
    if (seqRes.rows.length === 0) {
      res.status(404).json({ error: 'Sequence not found' });
      return;
    }

    const stepsRes = await query<SequenceStep>(
      `SELECT ss.*, t.name AS template_name
       FROM sequence_steps ss
       LEFT JOIN templates t ON t.id = ss.template_id
       WHERE ss.sequence_id = $1 ORDER BY ss.step_order ASC`,
      [req.params.id]
    );

    const statsRes = await query(
      `SELECT
        COUNT(*) AS total_enrolled,
        COUNT(*) FILTER (WHERE status = 'active') AS active,
        COUNT(*) FILTER (WHERE status = 'completed') AS completed,
        COUNT(*) FILTER (WHERE status = 'replied') AS replied
       FROM sequence_enrollments WHERE sequence_id = $1`,
      [req.params.id]
    );

    res.json({
      sequence: seqRes.rows[0],
      steps: stepsRes.rows,
      stats: statsRes.rows[0],
    });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to fetch sequence' });
  }
});

// Create sequence
router.post(
  '/',
  validate([{ field: 'name', required: true, type: 'string', minLength: 1, maxLength: 255 }]),
  async (req: Request, res: Response) => {
    try {
      const { name, description, send_window_start, send_window_end, send_timezone } = req.body;
      const result = await query<Sequence>(
        `INSERT INTO sequences (workspace_id, name, description, send_window_start, send_window_end, send_timezone, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
        [
          req.user!.workspaceId, name, description || null,
          send_window_start || '09:00:00', send_window_end || '17:00:00',
          send_timezone || 'America/New_York', req.user!.userId,
        ]
      );
      res.status(201).json({ sequence: result.rows[0] });
    } catch (err: any) {
      res.status(500).json({ error: 'Failed to create sequence' });
    }
  }
);

// Update sequence
router.put('/:id', async (req: Request, res: Response) => {
  try {
    const { name, description, status, send_window_start, send_window_end, send_timezone } = req.body;
    const result = await query<Sequence>(
      `UPDATE sequences SET
        name = COALESCE($1, name),
        description = COALESCE($2, description),
        status = COALESCE($3, status),
        send_window_start = COALESCE($4, send_window_start),
        send_window_end = COALESCE($5, send_window_end),
        send_timezone = COALESCE($6, send_timezone)
       WHERE id = $7 AND workspace_id = $8 RETURNING *`,
      [name, description, status, send_window_start, send_window_end, send_timezone, req.params.id, req.user!.workspaceId]
    );
    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Sequence not found' });
      return;
    }
    res.json({ sequence: result.rows[0] });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to update sequence' });
  }
});

router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const result = await query(
      'DELETE FROM sequences WHERE id = $1 AND workspace_id = $2 RETURNING id',
      [req.params.id, req.user!.workspaceId]
    );
    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Sequence not found' });
      return;
    }
    res.json({ deleted: true });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to delete sequence' });
  }
});

// === STEPS ===

router.post('/:id/steps', async (req: Request, res: Response) => {
  try {
    const { step_order, step_type, delay_days, delay_hours, template_id, subject_override, condition_type, condition_value, parent_step_id, branch_label } = req.body;

    // Verify sequence belongs to workspace
    const seq = await query('SELECT id FROM sequences WHERE id = $1 AND workspace_id = $2', [req.params.id, req.user!.workspaceId]);
    if (seq.rows.length === 0) {
      res.status(404).json({ error: 'Sequence not found' });
      return;
    }

    const result = await query<SequenceStep>(
      `INSERT INTO sequence_steps (sequence_id, step_order, step_type, delay_days, delay_hours, template_id, subject_override, condition_type, condition_value, parent_step_id, branch_label)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
      [
        req.params.id, step_order || 1, step_type || 'email',
        delay_days || 0, delay_hours || 0, template_id || null,
        subject_override || null, condition_type || null, condition_value || null,
        parent_step_id || null, branch_label || null,
      ]
    );

    res.status(201).json({ step: result.rows[0] });
  } catch (err: any) {
    console.error('Create step error:', err);
    res.status(500).json({ error: 'Failed to create step' });
  }
});

router.put('/:id/steps/:stepId', async (req: Request, res: Response) => {
  try {
    const { step_order, step_type, delay_days, delay_hours, template_id, subject_override, condition_type, condition_value, branch_label, is_active } = req.body;

    const result = await query<SequenceStep>(
      `UPDATE sequence_steps SET
        step_order = COALESCE($1, step_order),
        step_type = COALESCE($2, step_type),
        delay_days = COALESCE($3, delay_days),
        delay_hours = COALESCE($4, delay_hours),
        template_id = COALESCE($5, template_id),
        subject_override = COALESCE($6, subject_override),
        condition_type = COALESCE($7, condition_type),
        condition_value = COALESCE($8, condition_value),
        branch_label = COALESCE($9, branch_label),
        is_active = COALESCE($10, is_active)
       WHERE id = $11 AND sequence_id = $12 RETURNING *`,
      [step_order, step_type, delay_days, delay_hours, template_id, subject_override, condition_type, condition_value, branch_label, is_active, req.params.stepId, req.params.id]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Step not found' });
      return;
    }
    res.json({ step: result.rows[0] });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to update step' });
  }
});

router.delete('/:id/steps/:stepId', async (req: Request, res: Response) => {
  try {
    await query('DELETE FROM sequence_steps WHERE id = $1 AND sequence_id = $2', [req.params.stepId, req.params.id]);
    res.json({ deleted: true });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to delete step' });
  }
});

// === ENROLLMENT ===

router.post('/:id/enroll', async (req: Request, res: Response) => {
  try {
    const { contactIds } = req.body;
    const wsId = req.user!.workspaceId;
    const seqId = req.params.id;

    // Verify sequence is active
    const seq = await query("SELECT id FROM sequences WHERE id = $1 AND workspace_id = $2 AND status = 'active'", [seqId, wsId]);
    if (seq.rows.length === 0) {
      res.status(400).json({ error: 'Sequence not found or not active' });
      return;
    }

    if (Array.isArray(contactIds) && contactIds.length > 1) {
      const result = await bulkEnroll(seqId, contactIds, wsId);
      res.json(result);
    } else {
      const contactId = Array.isArray(contactIds) ? contactIds[0] : contactIds;
      const enrollment = await enrollContact(seqId, contactId, wsId);
      res.json({ enrollment });
    }
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// Pause/cancel enrollment
router.post('/:id/enrollments/:enrollmentId/cancel', async (req: Request, res: Response) => {
  try {
    await cancelEnrollmentJobs(req.params.enrollmentId);
    await query(
      "UPDATE sequence_enrollments SET status = 'cancelled' WHERE id = $1 AND sequence_id = $2",
      [req.params.enrollmentId, req.params.id]
    );
    res.json({ cancelled: true });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to cancel enrollment' });
  }
});

// List enrollments for sequence
router.get('/:id/enrollments', async (req: Request, res: Response) => {
  try {
    const { page, limit, offset } = parsePagination(req);
    const status = req.query.status as string;

    let where = 'WHERE se.sequence_id = $1';
    const params: any[] = [req.params.id];
    let idx = 2;

    if (status) {
      where += ` AND se.status = $${idx++}`;
      params.push(status);
    }

    const countRes = await query(`SELECT COUNT(*) FROM sequence_enrollments se ${where}`, params);
    const total = parseInt(countRes.rows[0].count);

    const dataRes = await query(
      `SELECT se.*, c.email, c.first_name, c.last_name, c.company
       FROM sequence_enrollments se
       JOIN contacts c ON c.id = se.contact_id
       ${where} ORDER BY se.enrolled_at DESC LIMIT $${idx++} OFFSET $${idx}`,
      [...params, limit, offset]
    );

    res.json({ data: dataRes.rows, total, page, limit, totalPages: Math.ceil(total / limit) });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to fetch enrollments' });
  }
});

export default router;
