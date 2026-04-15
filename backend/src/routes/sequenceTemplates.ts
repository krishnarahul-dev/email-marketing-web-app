import { Router, Request, Response } from 'express';
import { query, transaction } from '../config/database';
import { authMiddleware } from '../middleware/auth';

const router = Router();
router.use(authMiddleware);

// Browse public template library
router.get('/library', async (req: Request, res: Response) => {
  try {
    const category = req.query.category as string;
    let where = 'WHERE is_public = TRUE';
    const params: any[] = [];
    if (category) { where += ' AND category = $1'; params.push(category); }
    const result = await query(
      `SELECT id, name, description, category, industry, step_count, template_data
       FROM sequence_template_library ${where} ORDER BY category, name`,
      params
    );
    res.json({ templates: result.rows });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to fetch library' });
  }
});

// Get template details
router.get('/library/:id', async (req: Request, res: Response) => {
  try {
    const result = await query(
      'SELECT * FROM sequence_template_library WHERE id = $1',
      [req.params.id]
    );
    if (result.rows.length === 0) { res.status(404).json({ error: 'Template not found' }); return; }
    res.json({ template: result.rows[0] });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to fetch template' });
  }
});

// Instantiate library template into a new sequence
router.post('/library/:id/instantiate', async (req: Request, res: Response) => {
  try {
    const { name } = req.body;
    const wsId = req.user!.workspaceId;

    const tplResult = await query(
      'SELECT * FROM sequence_template_library WHERE id = $1',
      [req.params.id]
    );
    if (tplResult.rows.length === 0) { res.status(404).json({ error: 'Template not found' }); return; }
    const tpl = tplResult.rows[0];

    const sequence = await transaction(async (client) => {
      const seq = await client.query(
        `INSERT INTO sequences (workspace_id, name, description, status, owner_id, send_window_start, send_window_end, send_timezone)
         VALUES ($1, $2, $3, 'draft', $4, '09:00:00', '17:00:00', 'America/New_York') RETURNING *`,
        [wsId, name || tpl.name, tpl.description, req.user!.userId]
      );
      const sequenceId = seq.rows[0].id;

      const stepsData = tpl.template_data?.steps || [];
      for (const step of stepsData) {
        await client.query(
          `INSERT INTO sequence_steps
            (sequence_id, step_order, step_type, step_name, delay_days, delay_business_days, delay_hours,
             subject_override, task_type, task_instructions)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
          [
            sequenceId,
            step.order || 1,
            step.type || 'email',
            step.name || `Step ${step.order}`,
            step.delay_days || 0,
            step.delay_business_days || 0,
            step.delay_hours || 0,
            step.subject || null,
            step.task_type || null,
            step.instructions || null,
          ]
        );
      }

      return seq.rows[0];
    });

    res.status(201).json({ sequence });
  } catch (err: any) {
    console.error('Instantiate template error:', err);
    res.status(500).json({ error: 'Failed to instantiate template' });
  }
});

// Duplicate a user-owned sequence
router.post('/sequences/:id/duplicate', async (req: Request, res: Response) => {
  try {
    const wsId = req.user!.workspaceId;
    const sourceId = req.params.id;
    const { name } = req.body;

    const source = await query(
      'SELECT * FROM sequences WHERE id = $1 AND workspace_id = $2',
      [sourceId, wsId]
    );
    if (source.rows.length === 0) { res.status(404).json({ error: 'Source sequence not found' }); return; }
    const src = source.rows[0];

    const result = await transaction(async (client) => {
      const newSeq = await client.query(
        `INSERT INTO sequences (workspace_id, name, description, status, owner_id, cloned_from,
           send_window_start, send_window_end, send_timezone, daily_send_limit, hourly_send_limit,
           skip_weekends, auto_pause_on_reply, auto_pause_on_meeting)
         VALUES ($1, $2, $3, 'draft', $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) RETURNING *`,
        [
          wsId, name || `${src.name} (copy)`, src.description, req.user!.userId, sourceId,
          src.send_window_start, src.send_window_end, src.send_timezone,
          src.daily_send_limit, src.hourly_send_limit, src.skip_weekends,
          src.auto_pause_on_reply, src.auto_pause_on_meeting,
        ]
      );
      const newSeqId = newSeq.rows[0].id;

      // Copy steps (preserving order and parent relationships within the new sequence)
      const stepIdMap = new Map<string, string>();
      const stepsResult = await client.query(
        'SELECT * FROM sequence_steps WHERE sequence_id = $1 ORDER BY parent_step_id NULLS FIRST, step_order',
        [sourceId]
      );

      for (const step of stepsResult.rows) {
        const newParentId = step.parent_step_id ? stepIdMap.get(step.parent_step_id) || null : null;
        const newStep = await client.query(
          `INSERT INTO sequence_steps (sequence_id, step_order, step_type, step_name, delay_days,
             delay_business_days, delay_hours, delay_minutes, template_id, subject_override,
             condition_type, condition_value, parent_step_id, branch_label, task_type,
             task_instructions, task_priority, ab_test_enabled, use_spintax)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19) RETURNING id`,
          [
            newSeqId, step.step_order, step.step_type, step.step_name, step.delay_days,
            step.delay_business_days, step.delay_hours, step.delay_minutes, step.template_id,
            step.subject_override, step.condition_type, step.condition_value, newParentId,
            step.branch_label, step.task_type, step.task_instructions, step.task_priority,
            step.ab_test_enabled, step.use_spintax,
          ]
        );
        stepIdMap.set(step.id, newStep.rows[0].id);

        // Copy AB variants for this step
        const variants = await client.query('SELECT * FROM ab_variants WHERE step_id = $1', [step.id]);
        for (const v of variants.rows) {
          await client.query(
            `INSERT INTO ab_variants (step_id, variant_label, subject, template_id, weight)
             VALUES ($1, $2, $3, $4, $5)`,
            [newStep.rows[0].id, v.variant_label, v.subject, v.template_id, v.weight]
          );
        }
      }

      return newSeq.rows[0];
    });

    res.status(201).json({ sequence: result });
  } catch (err: any) {
    console.error('Duplicate sequence error:', err);
    res.status(500).json({ error: 'Failed to duplicate sequence' });
  }
});

export default router;
