import { Router, Request, Response } from 'express';
import { query } from '../config/database';
import { authMiddleware } from '../middleware/auth';

const router = Router();
router.use(authMiddleware);

// List all schedules in workspace
router.get('/', async (req: Request, res: Response) => {
  try {
    const result = await query(
      `SELECT * FROM sequence_schedules WHERE workspace_id = $1 ORDER BY is_default DESC, name ASC`,
      [req.user!.workspaceId]
    );
    res.json({ schedules: result.rows });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to fetch schedules' });
  }
});

// Get one schedule
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const result = await query(
      'SELECT * FROM sequence_schedules WHERE id = $1 AND workspace_id = $2',
      [req.params.id, req.user!.workspaceId]
    );
    if (result.rows.length === 0) { res.status(404).json({ error: 'Schedule not found' }); return; }
    res.json({ schedule: result.rows[0] });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to fetch schedule' });
  }
});

// Create new schedule
router.post('/', async (req: Request, res: Response) => {
  try {
    const {
      name, timezone,
      monday_start, monday_end, tuesday_start, tuesday_end,
      wednesday_start, wednesday_end, thursday_start, thursday_end,
      friday_start, friday_end, saturday_start, saturday_end,
      sunday_start, sunday_end,
    } = req.body;

    if (!name) { res.status(400).json({ error: 'name is required' }); return; }

    const result = await query(
      `INSERT INTO sequence_schedules (workspace_id, name, timezone,
         monday_start, monday_end, tuesday_start, tuesday_end,
         wednesday_start, wednesday_end, thursday_start, thursday_end,
         friday_start, friday_end, saturday_start, saturday_end,
         sunday_start, sunday_end)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) RETURNING *`,
      [
        req.user!.workspaceId, name, timezone || 'America/New_York',
        monday_start || null, monday_end || null,
        tuesday_start || null, tuesday_end || null,
        wednesday_start || null, wednesday_end || null,
        thursday_start || null, thursday_end || null,
        friday_start || null, friday_end || null,
        saturday_start || null, saturday_end || null,
        sunday_start || null, sunday_end || null,
      ]
    );
    res.status(201).json({ schedule: result.rows[0] });
  } catch (err: any) {
    console.error('Create schedule error:', err);
    res.status(500).json({ error: 'Failed to create schedule' });
  }
});

// Update schedule
router.put('/:id', async (req: Request, res: Response) => {
  try {
    const fields = [
      'name', 'timezone',
      'monday_start', 'monday_end', 'tuesday_start', 'tuesday_end',
      'wednesday_start', 'wednesday_end', 'thursday_start', 'thursday_end',
      'friday_start', 'friday_end', 'saturday_start', 'saturday_end',
      'sunday_start', 'sunday_end',
    ];

    const updates: string[] = [];
    const values: any[] = [];
    let idx = 1;

    for (const field of fields) {
      if (field in req.body) {
        updates.push(`${field} = $${idx++}`);
        values.push(req.body[field] || null);
      }
    }

    if (updates.length === 0) {
      res.status(400).json({ error: 'No fields to update' });
      return;
    }

    values.push(req.params.id, req.user!.workspaceId);
    const result = await query(
      `UPDATE sequence_schedules SET ${updates.join(', ')}, updated_at = NOW()
       WHERE id = $${idx++} AND workspace_id = $${idx} RETURNING *`,
      values
    );
    if (result.rows.length === 0) { res.status(404).json({ error: 'Schedule not found' }); return; }
    res.json({ schedule: result.rows[0] });
  } catch (err: any) {
    console.error('Update schedule error:', err);
    res.status(500).json({ error: 'Failed to update schedule' });
  }
});

// Set as workspace default
router.post('/:id/set-default', async (req: Request, res: Response) => {
  try {
    await query(
      `UPDATE sequence_schedules SET is_default = (id = $1) WHERE workspace_id = $2`,
      [req.params.id, req.user!.workspaceId]
    );
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to set default' });
  }
});

// Delete schedule
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    // Don't allow deleting the default schedule
    const check = await query(
      'SELECT is_default FROM sequence_schedules WHERE id = $1 AND workspace_id = $2',
      [req.params.id, req.user!.workspaceId]
    );
    if (check.rows.length === 0) { res.status(404).json({ error: 'Schedule not found' }); return; }
    if (check.rows[0].is_default) {
      res.status(400).json({ error: 'Cannot delete the default schedule. Set another as default first.' });
      return;
    }
    await query('DELETE FROM sequence_schedules WHERE id = $1', [req.params.id]);
    res.json({ deleted: true });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to delete schedule' });
  }
});

export default router;
