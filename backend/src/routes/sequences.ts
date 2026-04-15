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
    const fields: string[] = [];
    const values: any[] = [];
    let idx = 1;

    const allowedFields = ['name', 'description', 'status', 'send_window_start', 'send_window_end', 'send_timezone', 'schedule_id', 'preferred_mailbox_id'];

    for (const field of allowedFields) {
      if (field in req.body) {
        fields.push(`${field} = $${idx++}`);
        values.push(req.body[field] ?? null);
      }
    }

    if (fields.length === 0) {
      res.status(400).json({ error: 'No fields to update' });
      return;
    }

    values.push(req.params.id, req.user!.workspaceId);
    const result = await query<Sequence>(
      `UPDATE sequences SET ${fields.join(', ')}, updated_at = NOW()
       WHERE id = $${idx++} AND workspace_id = $${idx} RETURNING *`,
      values
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
    const {
      step_order, step_type, step_name, delay_days, delay_hours, delay_minutes, delay_business_days,
      template_id, subject_override, subject, body_html, body_text, thread_mode, include_signature,
      condition_type, condition_value, parent_step_id, branch_label,
      task_type, task_instructions, task_priority,
    } = req.body;

    // Verify sequence belongs to workspace
    const seq = await query('SELECT id FROM sequences WHERE id = $1 AND workspace_id = $2', [req.params.id, req.user!.workspaceId]);
    if (seq.rows.length === 0) {
      res.status(404).json({ error: 'Sequence not found' });
      return;
    }

    const result = await query<SequenceStep>(
      `INSERT INTO sequence_steps (sequence_id, step_order, step_type, step_name,
         delay_days, delay_hours, delay_minutes, delay_business_days,
         template_id, subject_override, subject, body_html, body_text,
         thread_mode, include_signature,
         condition_type, condition_value, parent_step_id, branch_label,
         task_type, task_instructions, task_priority)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22) RETURNING *`,
      [
        req.params.id, step_order || 1, step_type || 'email', step_name || null,
        delay_days || 0, delay_hours || 0, delay_minutes || 0, delay_business_days || 0,
        template_id || null, subject_override || null, subject || null, body_html || null, body_text || null,
        thread_mode || 'new', include_signature !== false,
        condition_type || null, condition_value || null, parent_step_id || null, branch_label || null,
        task_type || null, task_instructions || null, task_priority || 'normal',
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
    const fields: string[] = [];
    const values: any[] = [];
    let idx = 1;

    const allowedFields = [
      'step_order', 'step_type', 'step_name', 'delay_days', 'delay_hours', 'delay_minutes',
      'delay_business_days', 'template_id', 'subject_override', 'subject', 'body_html', 'body_text',
      'thread_mode', 'include_signature', 'condition_type', 'condition_value', 'branch_label',
      'is_active', 'task_type', 'task_instructions', 'task_priority', 'ab_test_enabled', 'use_spintax',
    ];

    for (const field of allowedFields) {
      if (field in req.body) {
        fields.push(`${field} = $${idx++}`);
        values.push(req.body[field] ?? null);
      }
    }

    if (fields.length === 0) {
      res.status(400).json({ error: 'No fields to update' });
      return;
    }

    values.push(req.params.stepId, req.params.id);
    const result = await query<SequenceStep>(
      `UPDATE sequence_steps SET ${fields.join(', ')}, updated_at = NOW()
       WHERE id = $${idx++} AND sequence_id = $${idx} RETURNING *`,
      values
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
    const wsId = String(req.user!.workspaceId);
const seqId = String(req.params.id);

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
    const enrollmentId = String(req.params.enrollmentId);
await cancelEnrollmentJobs(enrollmentId);
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

// ════════════════════════════════════════════════════════════
// SEQUENCE DETAIL PAGE — Contacts tab
// ════════════════════════════════════════════════════════════
router.get('/:id/contacts', async (req: Request, res: Response) => {
  try {
    const wsId = String(req.user!.workspaceId);
    const seqId = String(req.params.id);
    const { page, limit, offset } = parsePagination(req);
    const engagementStatus = req.query.engagement_status as string;
    const search = req.query.search as string;

    let where = 'WHERE v.sequence_id = $1 AND v.workspace_id = $2';
    const params: any[] = [seqId, wsId];
    let idx = 3;

    if (engagementStatus && engagementStatus !== 'total') {
      where += ` AND v.engagement_status = $${idx++}`;
      params.push(engagementStatus);
    }
    if (search) {
      where += ` AND (v.email ILIKE $${idx} OR v.first_name ILIKE $${idx} OR v.last_name ILIKE $${idx} OR v.company ILIKE $${idx})`;
      params.push(`%${search}%`);
      idx++;
    }

    const countRes = await query(`SELECT COUNT(*) FROM v_sequence_contact_status v ${where}`, params);
    const total = parseInt(countRes.rows[0].count);

    const dataRes = await query(
      `SELECT * FROM v_sequence_contact_status v ${where}
       ORDER BY last_activity_at DESC NULLS LAST, enrolled_at DESC
       LIMIT $${idx++} OFFSET $${idx}`,
      [...params, limit, offset]
    );

    res.json({ data: dataRes.rows, total, page, limit, totalPages: Math.ceil(total / limit) });
  } catch (err: any) {
    console.error('Sequence contacts error:', err);
    res.status(500).json({ error: 'Failed to fetch sequence contacts' });
  }
});

// Counts per engagement bucket for the filter tabs
router.get('/:id/contacts/counts', async (req: Request, res: Response) => {
  try {
    const wsId = String(req.user!.workspaceId);
    const seqId = String(req.params.id);

    const result = await query(
      `SELECT
         COUNT(*) AS total,
         COUNT(*) FILTER (WHERE engagement_status = 'cold') AS cold,
         COUNT(*) FILTER (WHERE engagement_status = 'approaching') AS approaching,
         COUNT(*) FILTER (WHERE engagement_status = 'engaged') AS engaged,
         COUNT(*) FILTER (WHERE engagement_status = 'replied') AS replied,
         COUNT(*) FILTER (WHERE engagement_status = 'unresponsive') AS unresponsive,
         COUNT(*) FILTER (WHERE engagement_status = 'bounced') AS bounced,
         COUNT(*) FILTER (WHERE engagement_status = 'unsubscribed') AS unsubscribed,
         COUNT(*) FILTER (WHERE engagement_status = 'paused') AS paused,
         COUNT(*) FILTER (WHERE engagement_status = 'finished') AS finished,
         COUNT(*) FILTER (WHERE reply_tone = 'interested') AS interested,
         COUNT(*) FILTER (WHERE reply_tone = 'not_interested') AS not_interested
       FROM v_sequence_contact_status
       WHERE sequence_id = $1 AND workspace_id = $2`,
      [seqId, wsId]
    );
    res.json({ counts: result.rows[0] });
  } catch (err: any) {
    console.error('Contact counts error:', err);
    res.status(500).json({ error: 'Failed to fetch counts' });
  }
});

// ════════════════════════════════════════════════════════════
// SEQUENCE DETAIL PAGE — Emails tab
// ════════════════════════════════════════════════════════════
router.get('/:id/emails', async (req: Request, res: Response) => {
  try {
    const wsId = String(req.user!.workspaceId);
    const seqId = String(req.params.id);
    const { page, limit, offset } = parsePagination(req);
    const status = req.query.status as string;
    const search = req.query.search as string;

    let where = 'WHERE el.sequence_id = $1 AND el.workspace_id = $2';
    const params: any[] = [seqId, wsId];
    let idx = 3;

    // Status tab filtering
    switch (status) {
      case 'scheduled':
        where += " AND el.status = 'queued'";
        break;
      case 'delivered':
        where += " AND el.status IN ('sent','delivered','opened','clicked','replied')";
        break;
      case 'not_opened':
        where += " AND el.status IN ('sent','delivered') AND el.opened_at IS NULL";
        break;
      case 'opened':
        where += ' AND el.opened_at IS NOT NULL';
        break;
      case 'clicked':
        where += ' AND el.clicked_at IS NOT NULL';
        break;
      case 'replied':
        where += ' AND el.replied_at IS NOT NULL';
        break;
      case 'bounced':
        where += " AND el.status = 'bounced'";
        break;
      case 'spam_blocked':
        where += " AND el.status = 'complained'";
        break;
      case 'failed':
        where += " AND el.status = 'failed'";
        break;
    }

    if (search) {
      where += ` AND (el.to_email ILIKE $${idx} OR el.subject ILIKE $${idx} OR c.first_name ILIKE $${idx} OR c.last_name ILIKE $${idx})`;
      params.push(`%${search}%`);
      idx++;
    }

    const countRes = await query(
      `SELECT COUNT(*) FROM email_logs el JOIN contacts c ON c.id = el.contact_id ${where}`,
      params
    );
    const total = parseInt(countRes.rows[0].count);

    const dataRes = await query(
      `SELECT el.id, el.subject, el.to_email, el.status, el.sent_at, el.opened_at,
         el.clicked_at, el.replied_at, el.bounced_at, el.created_at, el.step_id,
         c.first_name, c.last_name, c.company,
         ss.step_order, ss.step_name
       FROM email_logs el
       JOIN contacts c ON c.id = el.contact_id
       LEFT JOIN sequence_steps ss ON ss.id = el.step_id
       ${where}
       ORDER BY el.created_at DESC
       LIMIT $${idx++} OFFSET $${idx}`,
      [...params, limit, offset]
    );

    res.json({ data: dataRes.rows, total, page, limit, totalPages: Math.ceil(total / limit) });
  } catch (err: any) {
    console.error('Sequence emails error:', err);
    res.status(500).json({ error: 'Failed to fetch sequence emails' });
  }
});

router.get('/:id/emails/counts', async (req: Request, res: Response) => {
  try {
    const result = await query(
      `SELECT
         COUNT(*) AS total,
         COUNT(*) FILTER (WHERE status = 'queued') AS scheduled,
         COUNT(*) FILTER (WHERE status IN ('sent','delivered','opened','clicked','replied')) AS delivered,
         COUNT(*) FILTER (WHERE status IN ('sent','delivered') AND opened_at IS NULL) AS not_opened,
         COUNT(*) FILTER (WHERE opened_at IS NOT NULL) AS opened,
         COUNT(*) FILTER (WHERE clicked_at IS NOT NULL) AS clicked,
         COUNT(*) FILTER (WHERE replied_at IS NOT NULL) AS replied,
         COUNT(*) FILTER (WHERE status = 'bounced') AS bounced,
         COUNT(*) FILTER (WHERE status = 'complained') AS spam_blocked,
         COUNT(*) FILTER (WHERE status = 'failed') AS failed
       FROM email_logs WHERE sequence_id = $1 AND workspace_id = $2`,
      [String(req.params.id), String(req.user!.workspaceId)]
    );
    res.json({ counts: result.rows[0] });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to fetch email counts' });
  }
});

// ════════════════════════════════════════════════════════════
// SEQUENCE DETAIL PAGE — Activity tab
// ════════════════════════════════════════════════════════════
router.get('/:id/activity', async (req: Request, res: Response) => {
  try {
    const { page, limit, offset } = parsePagination(req);
    const wsId = String(req.user!.workspaceId);
    const seqId = String(req.params.id);

    const countRes = await query(
      'SELECT COUNT(*) FROM activity_log WHERE sequence_id = $1 AND workspace_id = $2',
      [seqId, wsId]
    );
    const total = parseInt(countRes.rows[0].count);

    const dataRes = await query(
      `SELECT al.*, u.name AS user_name, u.email AS user_email,
         c.first_name, c.last_name, c.email AS contact_email
       FROM activity_log al
       LEFT JOIN users u ON u.id = al.user_id
       LEFT JOIN contacts c ON c.id = al.contact_id
       WHERE al.sequence_id = $1 AND al.workspace_id = $2
       ORDER BY al.created_at DESC
       LIMIT $3 OFFSET $4`,
      [seqId, wsId, limit, offset]
    );

    res.json({ data: dataRes.rows, total, page, limit, totalPages: Math.ceil(total / limit) });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to fetch sequence activity' });
  }
});

// ════════════════════════════════════════════════════════════
// SEQUENCE DETAIL PAGE — Report tab (funnel + audience)
// ════════════════════════════════════════════════════════════
router.get('/:id/report', async (req: Request, res: Response) => {
  try {
    const wsId = String(req.user!.workspaceId);
    const seqId = String(req.params.id);

    // Funnel by contact (each contact counted once)
    const funnelByContact = await query(
      `SELECT
         COUNT(DISTINCT contact_id) FILTER (WHERE status NOT IN ('queued','failed')) AS delivered,
         COUNT(DISTINCT contact_id) FILTER (WHERE opened_at IS NOT NULL) AS opened,
         COUNT(DISTINCT contact_id) FILTER (WHERE clicked_at IS NOT NULL) AS clicked,
         COUNT(DISTINCT contact_id) FILTER (WHERE replied_at IS NOT NULL) AS replied
       FROM email_logs WHERE sequence_id = $1 AND workspace_id = $2`,
      [seqId, wsId]
    );

    // Funnel by email (every send counted)
    const funnelByEmail = await query(
      `SELECT
         COUNT(*) FILTER (WHERE status NOT IN ('queued','failed')) AS delivered,
         COUNT(*) FILTER (WHERE opened_at IS NOT NULL) AS opened,
         COUNT(*) FILTER (WHERE clicked_at IS NOT NULL) AS clicked,
         COUNT(*) FILTER (WHERE replied_at IS NOT NULL) AS replied
       FROM email_logs WHERE sequence_id = $1 AND workspace_id = $2`,
      [seqId, wsId]
    );

    // Interested count from reply_messages tone
    const interested = await query(
      `SELECT COUNT(DISTINCT rm.contact_id) AS count
       FROM reply_messages rm
       JOIN email_logs el ON el.id = rm.email_log_id
       WHERE el.sequence_id = $1 AND el.workspace_id = $2 AND rm.detected_tone = 'interested'`,
      [seqId, wsId]
    );

    // Audience breakdown by company size (bucketed from contact custom fields)
    const audienceByCompany = await query(
      `SELECT c.company, COUNT(*) AS sent_count,
         COUNT(*) FILTER (WHERE el.opened_at IS NOT NULL) AS opened,
         COUNT(*) FILTER (WHERE el.replied_at IS NOT NULL) AS replied
       FROM email_logs el
       JOIN contacts c ON c.id = el.contact_id
       WHERE el.sequence_id = $1 AND el.workspace_id = $2 AND c.company IS NOT NULL
       GROUP BY c.company ORDER BY sent_count DESC LIMIT 10`,
      [seqId, wsId]
    );

    // Audience by job title
    const audienceByTitle = await query(
      `SELECT c.title, COUNT(*) AS sent_count,
         COUNT(*) FILTER (WHERE el.opened_at IS NOT NULL) AS opened,
         COUNT(*) FILTER (WHERE el.replied_at IS NOT NULL) AS replied
       FROM email_logs el
       JOIN contacts c ON c.id = el.contact_id
       WHERE el.sequence_id = $1 AND el.workspace_id = $2 AND c.title IS NOT NULL
       GROUP BY c.title ORDER BY sent_count DESC LIMIT 10`,
      [seqId, wsId]
    );

    // Per-step performance
    const stepPerformance = await query(
      `SELECT ss.id, ss.step_order, ss.step_name, ss.step_type, ss.subject,
         COUNT(el.id) AS sent,
         COUNT(*) FILTER (WHERE el.opened_at IS NOT NULL) AS opened,
         COUNT(*) FILTER (WHERE el.clicked_at IS NOT NULL) AS clicked,
         COUNT(*) FILTER (WHERE el.replied_at IS NOT NULL) AS replied,
         COUNT(*) FILTER (WHERE el.status = 'bounced') AS bounced
       FROM sequence_steps ss
       LEFT JOIN email_logs el ON el.step_id = ss.id AND el.status NOT IN ('queued','failed')
       WHERE ss.sequence_id = $1
       GROUP BY ss.id ORDER BY ss.step_order`,
      [seqId]
    );

    res.json({
      funnelByContact: funnelByContact.rows[0],
      funnelByEmail: funnelByEmail.rows[0],
      interested: parseInt(interested.rows[0]?.count || '0'),
      audienceByCompany: audienceByCompany.rows,
      audienceByTitle: audienceByTitle.rows,
      stepPerformance: stepPerformance.rows,
    });
  } catch (err: any) {
    console.error('Sequence report error:', err);
    res.status(500).json({ error: 'Failed to fetch sequence report' });
  }
});

// ════════════════════════════════════════════════════════════
// REORDER STEPS
// ════════════════════════════════════════════════════════════
router.post('/:id/steps/reorder', async (req: Request, res: Response) => {
  try {
    const { stepIds } = req.body;
    if (!Array.isArray(stepIds)) {
      res.status(400).json({ error: 'stepIds must be an array' });
      return;
    }

    // Verify ownership
    const seq = await query(
      'SELECT id FROM sequences WHERE id = $1 AND workspace_id = $2',
      [req.params.id, req.user!.workspaceId]
    );
    if (seq.rows.length === 0) { res.status(404).json({ error: 'Sequence not found' }); return; }

    // Update step_order for each
    for (let i = 0; i < stepIds.length; i++) {
      await query(
        'UPDATE sequence_steps SET step_order = $1 WHERE id = $2 AND sequence_id = $3',
        [i + 1, stepIds[i], req.params.id]
      );
    }

    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to reorder steps' });
  }
});

// ════════════════════════════════════════════════════════════
// PAUSE / RESUME ENROLLMENT
// ════════════════════════════════════════════════════════════
router.post('/:id/enrollments/:enrollmentId/pause', async (req: Request, res: Response) => {
  try {
    const { pauseEnrollment } = await import('../services/sequenceEngine');
    await pauseEnrollment(String(req.params.enrollmentId), 'manual');
    res.json({ paused: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to pause enrollment' });
  }
});

router.post('/:id/enrollments/:enrollmentId/resume', async (req: Request, res: Response) => {
  try {
    const { resumeEnrollment } = await import('../services/sequenceEngine');
    await resumeEnrollment(String(req.params.enrollmentId));
    res.json({ resumed: true });
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'Failed to resume enrollment' });
  }
});

// ════════════════════════════════════════════════════════════
// DUPLICATE SEQUENCE
// ════════════════════════════════════════════════════════════
router.post('/:id/duplicate', async (req: Request, res: Response) => {
  try {
    const { name } = req.body;
    const wsId = String(req.user!.workspaceId);
    const sourceId = String(req.params.id);

    const source = await query(
      'SELECT * FROM sequences WHERE id = $1 AND workspace_id = $2',
      [sourceId, wsId]
    );
    if (source.rows.length === 0) { res.status(404).json({ error: 'Sequence not found' }); return; }
    const src = source.rows[0];

    const newSeq = await query(
      `INSERT INTO sequences (workspace_id, name, description, status, owner_id, schedule_id,
         daily_send_limit, hourly_send_limit, skip_weekends,
         auto_pause_on_reply, auto_pause_on_meeting, cloned_from)
       VALUES ($1, $2, $3, 'draft', $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *`,
      [
        wsId, name || `${src.name} (copy)`, src.description, req.user!.userId, src.schedule_id,
        src.daily_send_limit || 100, src.hourly_send_limit || 30, src.skip_weekends,
        src.auto_pause_on_reply, src.auto_pause_on_meeting, sourceId,
      ]
    );

    const newSeqId = newSeq.rows[0].id;
    const stepIdMap = new Map<string, string>();

    const steps = await query(
      'SELECT * FROM sequence_steps WHERE sequence_id = $1 ORDER BY parent_step_id NULLS FIRST, step_order',
      [sourceId]
    );

    for (const step of steps.rows) {
      const newParentId = step.parent_step_id ? stepIdMap.get(step.parent_step_id) || null : null;
      const newStep = await query(
        `INSERT INTO sequence_steps (sequence_id, step_order, step_type, step_name, delay_days,
           delay_business_days, delay_hours, delay_minutes, template_id, subject_override,
           subject, body_html, body_text, thread_mode, include_signature,
           condition_type, condition_value, parent_step_id, branch_label,
           task_type, task_instructions, task_priority, ab_test_enabled, use_spintax)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24)
         RETURNING id`,
        [
          newSeqId, step.step_order, step.step_type, step.step_name, step.delay_days,
          step.delay_business_days, step.delay_hours, step.delay_minutes, step.template_id,
          step.subject_override, step.subject, step.body_html, step.body_text,
          step.thread_mode || 'new', step.include_signature !== false,
          step.condition_type, step.condition_value, newParentId, step.branch_label,
          step.task_type, step.task_instructions, step.task_priority || 'normal',
          step.ab_test_enabled || false, step.use_spintax || false,
        ]
      );
      stepIdMap.set(step.id, newStep.rows[0].id);
    }

    res.status(201).json({ sequence: newSeq.rows[0] });
  } catch (err: any) {
    console.error('Duplicate sequence error:', err);
    res.status(500).json({ error: 'Failed to duplicate sequence' });
  }
});

export default router;
