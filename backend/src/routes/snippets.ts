import { Router, Request, Response } from 'express';
import { query } from '../config/database';
import { authMiddleware } from '../middleware/auth';
import { invalidateSnippetCache } from '../utils/snippets';

const router = Router();
router.use(authMiddleware);

// List
router.get('/', async (req: Request, res: Response) => {
  try {
    const category = req.query.category as string;
    let where = 'WHERE workspace_id = $1';
    const params: any[] = [req.user!.workspaceId];
    if (category) { where += ' AND category = $2'; params.push(category); }
    const result = await query(
      `SELECT * FROM snippets ${where} ORDER BY use_count DESC, name ASC`,
      params
    );
    res.json({ snippets: result.rows });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to fetch snippets' });
  }
});

// Get one
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const result = await query(
      'SELECT * FROM snippets WHERE id = $1 AND workspace_id = $2',
      [req.params.id, req.user!.workspaceId]
    );
    if (result.rows.length === 0) { res.status(404).json({ error: 'Snippet not found' }); return; }
    res.json({ snippet: result.rows[0] });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to fetch snippet' });
  }
});

// Create
router.post('/', async (req: Request, res: Response) => {
  try {
    const { name, shortcut, content, content_html, category } = req.body;
    if (!name || !content) {
      res.status(400).json({ error: 'name and content are required' });
      return;
    }
    if (shortcut && !/^[a-zA-Z0-9_-]+$/.test(shortcut)) {
      res.status(400).json({ error: 'shortcut must be alphanumeric, underscore, or dash only' });
      return;
    }
    const result = await query(
      `INSERT INTO snippets (workspace_id, name, shortcut, content, content_html, category, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [req.user!.workspaceId, name, shortcut || null, content, content_html || null, category || 'general', req.user!.userId]
    );
    invalidateSnippetCache(req.user!.workspaceId);
    res.status(201).json({ snippet: result.rows[0] });
  } catch (err: any) {
    if (err.code === '23505') {
      res.status(409).json({ error: 'A snippet with this shortcut already exists' });
      return;
    }
    res.status(500).json({ error: 'Failed to create snippet' });
  }
});

// Update
router.put('/:id', async (req: Request, res: Response) => {
  try {
    const { name, shortcut, content, content_html, category } = req.body;
    const result = await query(
      `UPDATE snippets SET
         name = COALESCE($1, name),
         shortcut = COALESCE($2, shortcut),
         content = COALESCE($3, content),
         content_html = COALESCE($4, content_html),
         category = COALESCE($5, category)
       WHERE id = $6 AND workspace_id = $7 RETURNING *`,
      [name, shortcut, content, content_html, category, req.params.id, req.user!.workspaceId]
    );
    if (result.rows.length === 0) { res.status(404).json({ error: 'Snippet not found' }); return; }
    invalidateSnippetCache(req.user!.workspaceId);
    res.json({ snippet: result.rows[0] });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to update snippet' });
  }
});

// Delete
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    await query('DELETE FROM snippets WHERE id = $1 AND workspace_id = $2', [req.params.id, req.user!.workspaceId]);
    invalidateSnippetCache(req.user!.workspaceId);
    res.json({ deleted: true });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to delete snippet' });
  }
});

export default router;
