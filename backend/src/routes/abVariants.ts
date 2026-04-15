import { Router, Request, Response } from 'express';
import { query } from '../config/database';
import { authMiddleware } from '../middleware/auth';

const router = Router();
router.use(authMiddleware);

// List variants for a step
router.get('/step/:stepId', async (req: Request, res: Response) => {
  try {
    // Verify ownership through step → sequence → workspace
    const auth = await query(
      `SELECT 1 FROM sequence_steps ss
       JOIN sequences s ON s.id = ss.sequence_id
       WHERE ss.id = $1 AND s.workspace_id = $2`,
      [req.params.stepId, req.user!.workspaceId]
    );
    if (auth.rows.length === 0) { res.status(404).json({ error: 'Step not found' }); return; }

    const result = await query(
      'SELECT * FROM ab_variants WHERE step_id = $1 ORDER BY variant_label',
      [req.params.stepId]
    );
    res.json({ variants: result.rows });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to fetch variants' });
  }
});

// Create variant
router.post('/step/:stepId', async (req: Request, res: Response) => {
  try {
    const { variant_label, subject, template_id, weight } = req.body;

    const auth = await query(
      `SELECT 1 FROM sequence_steps ss
       JOIN sequences s ON s.id = ss.sequence_id
       WHERE ss.id = $1 AND s.workspace_id = $2`,
      [req.params.stepId, req.user!.workspaceId]
    );
    if (auth.rows.length === 0) { res.status(404).json({ error: 'Step not found' }); return; }

    const result = await query(
      `INSERT INTO ab_variants (step_id, variant_label, subject, template_id, weight)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [req.params.stepId, variant_label, subject || null, template_id || null, weight || 50]
    );

    // Enable A/B testing flag on the parent step
    await query('UPDATE sequence_steps SET ab_test_enabled = TRUE WHERE id = $1', [req.params.stepId]);

    res.status(201).json({ variant: result.rows[0] });
  } catch (err: any) {
    if (err.code === '23505') {
      res.status(409).json({ error: 'Variant label already exists for this step' });
      return;
    }
    res.status(500).json({ error: 'Failed to create variant' });
  }
});

// Update variant
router.put('/:variantId', async (req: Request, res: Response) => {
  try {
    const { subject, template_id, weight } = req.body;
    const result = await query(
      `UPDATE ab_variants SET subject = COALESCE($1, subject),
         template_id = COALESCE($2, template_id), weight = COALESCE($3, weight)
       WHERE id = $4 RETURNING *`,
      [subject, template_id, weight, req.params.variantId]
    );
    if (result.rows.length === 0) { res.status(404).json({ error: 'Variant not found' }); return; }
    res.json({ variant: result.rows[0] });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to update variant' });
  }
});

// Declare manual winner
router.post('/:variantId/declare-winner', async (req: Request, res: Response) => {
  try {
    const variant = await query('SELECT step_id FROM ab_variants WHERE id = $1', [req.params.variantId]);
    if (variant.rows.length === 0) { res.status(404).json({ error: 'Variant not found' }); return; }

    // Reset other variants on the same step
    await query('UPDATE ab_variants SET is_winner = FALSE WHERE step_id = $1', [variant.rows[0].step_id]);
    await query('UPDATE ab_variants SET is_winner = TRUE WHERE id = $1', [req.params.variantId]);
    await query('UPDATE sequence_steps SET ab_winner_variant_id = $1 WHERE id = $2', [req.params.variantId, variant.rows[0].step_id]);
    res.json({ declared: true });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to declare winner' });
  }
});

// Delete variant
router.delete('/:variantId', async (req: Request, res: Response) => {
  try {
    const variant = await query('SELECT step_id FROM ab_variants WHERE id = $1', [req.params.variantId]);
    if (variant.rows.length === 0) { res.status(404).json({ error: 'Variant not found' }); return; }

    await query('DELETE FROM ab_variants WHERE id = $1', [req.params.variantId]);

    // If no variants left, disable A/B testing
    const remaining = await query('SELECT COUNT(*) FROM ab_variants WHERE step_id = $1', [variant.rows[0].step_id]);
    if (parseInt(remaining.rows[0].count) === 0) {
      await query('UPDATE sequence_steps SET ab_test_enabled = FALSE, ab_winner_variant_id = NULL WHERE id = $1', [variant.rows[0].step_id]);
    }

    res.json({ deleted: true });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to delete variant' });
  }
});

export default router;
