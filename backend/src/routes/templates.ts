import { Router, Request, Response } from 'express';
import { query, transaction } from '../config/database';
import { authMiddleware } from '../middleware/auth';
import { validate } from '../middleware/validation';
import { parsePagination } from '../utils/pagination';
import { checkSpamScore } from '../utils/spamScorer';
import { Template, TemplateVersion } from '../types';

const router = Router();
router.use(authMiddleware);

router.get('/', async (req: Request, res: Response) => {
  try {
    const wsId = req.user!.workspaceId;
    const { page, limit, offset } = parsePagination(req);
    const category = req.query.category as string;

    let where = 'WHERE workspace_id = $1 AND is_active = TRUE';
    const params: any[] = [wsId];
    let idx = 2;

    if (category) {
      where += ` AND category = $${idx++}`;
      params.push(category);
    }

    const countRes = await query(`SELECT COUNT(*) FROM templates ${where}`, params);
    const total = parseInt(countRes.rows[0].count);

    const dataRes = await query<Template>(
      `SELECT * FROM templates ${where} ORDER BY updated_at DESC LIMIT $${idx++} OFFSET $${idx}`,
      [...params, limit, offset]
    );

    res.json({ data: dataRes.rows, total, page, limit, totalPages: Math.ceil(total / limit) });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to fetch templates' });
  }
});

router.get('/:id', async (req: Request, res: Response) => {
  try {
    const result = await query<Template>(
      'SELECT * FROM templates WHERE id = $1 AND workspace_id = $2',
      [req.params.id, req.user!.workspaceId]
    );
    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Template not found' });
      return;
    }
    res.json({ template: result.rows[0] });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to fetch template' });
  }
});

router.post(
  '/',
  validate([{ field: 'name', required: true, type: 'string', minLength: 1, maxLength: 255 }]),
  async (req: Request, res: Response) => {
    try {
      const { name, subject, html_content, design_json, text_content, category } = req.body;
      const result = await query<Template>(
        `INSERT INTO templates (workspace_id, name, subject, html_content, design_json, text_content, category, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
        [
          req.user!.workspaceId, name, subject || null, html_content || null,
          design_json ? JSON.stringify(design_json) : null, text_content || null,
          category || 'general', req.user!.userId,
        ]
      );
      res.status(201).json({ template: result.rows[0] });
    } catch (err: any) {
      res.status(500).json({ error: 'Failed to create template' });
    }
  }
);

router.put('/:id', async (req: Request, res: Response) => {
  try {
    const { name, subject, html_content, design_json, text_content, category } = req.body;

    const result = await transaction(async (client) => {
      const updated = await client.query<Template>(
        `UPDATE templates SET
          name = COALESCE($1, name),
          subject = COALESCE($2, subject),
          html_content = COALESCE($3, html_content),
          design_json = COALESCE($4, design_json),
          text_content = COALESCE($5, text_content),
          category = COALESCE($6, category)
         WHERE id = $7 AND workspace_id = $8 RETURNING *`,
        [
          name, subject, html_content,
          design_json ? JSON.stringify(design_json) : null,
          text_content, category, req.params.id, req.user!.workspaceId,
        ]
      );

      if (updated.rows.length === 0) return null;

      // Create version snapshot if html_content changed
      if (html_content) {
        const versionCount = await client.query(
          'SELECT COUNT(*) FROM template_versions WHERE template_id = $1',
          [req.params.id]
        );
        const nextVersion = parseInt(versionCount.rows[0].count) + 1;

        await client.query(
          `INSERT INTO template_versions (template_id, version_number, subject, html_content, design_json, text_content)
           VALUES ($1,$2,$3,$4,$5,$6)`,
          [
            req.params.id, nextVersion, updated.rows[0].subject,
            html_content, design_json ? JSON.stringify(design_json) : null, text_content || null,
          ]
        );
      }

      return updated.rows[0];
    });

    if (!result) {
      res.status(404).json({ error: 'Template not found' });
      return;
    }

    res.json({ template: result });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to update template' });
  }
});

router.delete('/:id', async (req: Request, res: Response) => {
  try {
    await query(
      'UPDATE templates SET is_active = FALSE WHERE id = $1 AND workspace_id = $2',
      [req.params.id, req.user!.workspaceId]
    );
    res.json({ deleted: true });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to delete template' });
  }
});

// Spam score check
router.post('/:id/spam-check', async (req: Request, res: Response) => {
  try {
    const template = await query<Template>(
      'SELECT html_content, subject FROM templates WHERE id = $1 AND workspace_id = $2',
      [req.params.id, req.user!.workspaceId]
    );
    if (template.rows.length === 0) {
      res.status(404).json({ error: 'Template not found' });
      return;
    }

    const result = checkSpamScore(template.rows[0].html_content || '', template.rows[0].subject || undefined);
    res.json({ spamCheck: result });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to check spam score' });
  }
});

// Body spam check (ad hoc)
router.post('/spam-check', async (req: Request, res: Response) => {
  try {
    const { html_content, subject } = req.body;
    if (!html_content) {
      res.status(400).json({ error: 'html_content is required' });
      return;
    }
    const result = checkSpamScore(html_content, subject);
    res.json({ spamCheck: result });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to check spam score' });
  }
});

// Get versions
router.get('/:id/versions', async (req: Request, res: Response) => {
  try {
    const result = await query<TemplateVersion>(
      'SELECT * FROM template_versions WHERE template_id = $1 ORDER BY version_number DESC',
      [req.params.id]
    );
    res.json({ versions: result.rows });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to fetch versions' });
  }
});

export default router;
