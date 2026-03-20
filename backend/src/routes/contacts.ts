import { Router, Request, Response } from 'express';
import multer from 'multer';
import csvParser from 'csv-parser';
import { Readable } from 'stream';
import { query, transaction } from '../config/database';
import { authMiddleware } from '../middleware/auth';
import { validate, sanitizeEmail } from '../middleware/validation';
import { parsePagination } from '../utils/pagination';
import { Contact } from '../types';

const router = Router();
router.use(authMiddleware);

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

// List contacts
router.get('/', async (req: Request, res: Response) => {
  try {
    const wsId = req.user!.workspaceId;
    const { page, limit, offset } = parsePagination(req);
    const status = req.query.status as string;
    const search = req.query.search as string;
    const source = req.query.source as string;
    const tag = req.query.tag as string;

    let where = 'WHERE c.workspace_id = $1';
    const params: any[] = [wsId];
    let paramIdx = 2;

    if (status) {
      where += ` AND c.status = $${paramIdx++}`;
      params.push(status);
    }
    if (search) {
      where += ` AND (c.email ILIKE $${paramIdx} OR c.first_name ILIKE $${paramIdx} OR c.last_name ILIKE $${paramIdx} OR c.company ILIKE $${paramIdx})`;
      params.push(`%${search}%`);
      paramIdx++;
    }
    if (source) {
      where += ` AND c.source = $${paramIdx++}`;
      params.push(source);
    }
    if (tag) {
      where += ` AND $${paramIdx++} = ANY(c.tags)`;
      params.push(tag);
    }

    const countResult = await query(`SELECT COUNT(*) FROM contacts c ${where}`, params);
    const total = parseInt(countResult.rows[0].count);

    const dataResult = await query<Contact>(
      `SELECT c.* FROM contacts c ${where} ORDER BY c.created_at DESC LIMIT $${paramIdx++} OFFSET $${paramIdx}`,
      [...params, limit, offset]
    );

    res.json({
      data: dataResult.rows,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    });
  } catch (err: any) {
    console.error('List contacts error:', err);
    res.status(500).json({ error: 'Failed to fetch contacts' });
  }
});

// Get single contact
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const result = await query<Contact>(
      'SELECT * FROM contacts WHERE id = $1 AND workspace_id = $2',
      [req.params.id, req.user!.workspaceId]
    );
    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Contact not found' });
      return;
    }
    res.json({ contact: result.rows[0] });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to fetch contact' });
  }
});

// Create contact
router.post(
  '/',
  validate([
    { field: 'email', required: true, type: 'email' },
  ]),
  async (req: Request, res: Response) => {
    try {
      const wsId = req.user!.workspaceId;
      const { email, first_name, last_name, company, title, phone, linkedin_url, source, tags, custom_fields } = req.body;

      const result = await query<Contact>(
        `INSERT INTO contacts (workspace_id, email, first_name, last_name, company, title, phone, linkedin_url, source, tags, custom_fields)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
         ON CONFLICT (workspace_id, email) DO UPDATE SET
           first_name = COALESCE(EXCLUDED.first_name, contacts.first_name),
           last_name = COALESCE(EXCLUDED.last_name, contacts.last_name),
           company = COALESCE(EXCLUDED.company, contacts.company),
           title = COALESCE(EXCLUDED.title, contacts.title),
           updated_at = NOW()
         RETURNING *`,
        [
          wsId, sanitizeEmail(email), first_name || null, last_name || null,
          company || null, title || null, phone || null, linkedin_url || null,
          source || 'manual', tags || [], custom_fields || {},
        ]
      );

      res.status(201).json({ contact: result.rows[0] });
    } catch (err: any) {
      console.error('Create contact error:', err);
      res.status(500).json({ error: 'Failed to create contact' });
    }
  }
);

// Update contact
router.put('/:id', async (req: Request, res: Response) => {
  try {
    const { first_name, last_name, company, title, phone, linkedin_url, tags, custom_fields, status } = req.body;

    const result = await query<Contact>(
      `UPDATE contacts SET
        first_name = COALESCE($1, first_name),
        last_name = COALESCE($2, last_name),
        company = COALESCE($3, company),
        title = COALESCE($4, title),
        phone = COALESCE($5, phone),
        linkedin_url = COALESCE($6, linkedin_url),
        tags = COALESCE($7, tags),
        custom_fields = COALESCE($8, custom_fields),
        status = COALESCE($9, status)
       WHERE id = $10 AND workspace_id = $11 RETURNING *`,
      [
        first_name, last_name, company, title, phone, linkedin_url,
        tags || null, custom_fields || null, status || null,
        req.params.id, req.user!.workspaceId,
      ]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Contact not found' });
      return;
    }

    res.json({ contact: result.rows[0] });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to update contact' });
  }
});

// Delete contact
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const result = await query(
      'DELETE FROM contacts WHERE id = $1 AND workspace_id = $2 RETURNING id',
      [req.params.id, req.user!.workspaceId]
    );
    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Contact not found' });
      return;
    }
    res.json({ deleted: true });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to delete contact' });
  }
});

// CSV Import
router.post('/import', upload.single('file'), async (req: Request, res: Response) => {
  try {
    if (!req.file) {
      res.status(400).json({ error: 'No file uploaded' });
      return;
    }

    const wsId = req.user!.workspaceId;
    const source = (req.body.source as string) || 'csv_import';
    const tags = req.body.tags ? JSON.parse(req.body.tags) : [];

    const contacts: any[] = [];

    await new Promise<void>((resolve, reject) => {
      const stream = Readable.from(req.file!.buffer);
      stream
        .pipe(csvParser())
        .on('data', (row: any) => {
          const email = (row.email || row.Email || row.EMAIL || row['E-mail'] || row['email address'] || '').trim().toLowerCase();
          if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return;

          contacts.push({
            email,
            first_name: row.first_name || row.firstName || row['First Name'] || row.name?.split(' ')[0] || null,
            last_name: row.last_name || row.lastName || row['Last Name'] || row.name?.split(' ').slice(1).join(' ') || null,
            company: row.company || row.Company || row.organization || null,
            title: row.title || row.Title || row['Job Title'] || row.position || null,
            phone: row.phone || row.Phone || row.mobile || null,
            linkedin_url: row.linkedin_url || row.linkedin || row['LinkedIn URL'] || null,
          });
        })
        .on('end', resolve)
        .on('error', reject);
    });

    if (contacts.length === 0) {
      res.status(400).json({ error: 'No valid contacts found in CSV' });
      return;
    }

    let imported = 0;
    let duplicates = 0;

    await transaction(async (client) => {
      for (const c of contacts) {
        const result = await client.query(
          `INSERT INTO contacts (workspace_id, email, first_name, last_name, company, title, phone, linkedin_url, source, tags)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
           ON CONFLICT (workspace_id, email) DO UPDATE SET
             first_name = COALESCE(NULLIF(EXCLUDED.first_name,''), contacts.first_name),
             last_name = COALESCE(NULLIF(EXCLUDED.last_name,''), contacts.last_name),
             company = COALESCE(NULLIF(EXCLUDED.company,''), contacts.company),
             title = COALESCE(NULLIF(EXCLUDED.title,''), contacts.title),
             updated_at = NOW()
           RETURNING (xmax = 0) AS is_insert`,
          [wsId, c.email, c.first_name, c.last_name, c.company, c.title, c.phone, c.linkedin_url, source, tags]
        );
        if (result.rows[0].is_insert) imported++;
        else duplicates++;
      }
    });

    res.json({
      total: contacts.length,
      imported,
      duplicates,
      message: `Imported ${imported} contacts, ${duplicates} updated as duplicates`,
    });
  } catch (err: any) {
    console.error('Import error:', err);
    res.status(500).json({ error: 'Failed to import contacts' });
  }
});

// Bulk tag
router.post('/bulk-tag', async (req: Request, res: Response) => {
  try {
    const { contactIds, tags } = req.body;
    if (!Array.isArray(contactIds) || !Array.isArray(tags)) {
      res.status(400).json({ error: 'contactIds and tags must be arrays' });
      return;
    }

    await query(
      `UPDATE contacts SET tags = array_cat(tags, $1::text[]), updated_at = NOW()
       WHERE id = ANY($2::uuid[]) AND workspace_id = $3`,
      [tags, contactIds, req.user!.workspaceId]
    );

    res.json({ updated: contactIds.length });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to tag contacts' });
  }
});

// Bulk delete
router.post('/bulk-delete', async (req: Request, res: Response) => {
  try {
    const { contactIds } = req.body;
    if (!Array.isArray(contactIds)) {
      res.status(400).json({ error: 'contactIds must be an array' });
      return;
    }

    const result = await query(
      'DELETE FROM contacts WHERE id = ANY($1::uuid[]) AND workspace_id = $2',
      [contactIds, req.user!.workspaceId]
    );

    res.json({ deleted: result.rowCount });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to delete contacts' });
  }
});

export default router;
