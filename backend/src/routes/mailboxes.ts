import { Router, Request, Response } from 'express';
import { query } from '../config/database';
import { authMiddleware } from '../middleware/auth';
import { encrypt, mask } from '../utils/encryption';
import {
  verifyEmailIdentity, checkVerificationStatus, deleteIdentity,
  getSendingQuota, invalidateSESClientCache,
} from '../services/sesService';
import { getWorkspaceCapacity } from '../services/mailboxService';

const router = Router();
router.use(authMiddleware);

// ════════════════════════════════════════════════════════════
// WORKSPACE AWS CREDENTIALS
// ════════════════════════════════════════════════════════════

// Get current workspace AWS settings (masked)
router.get('/aws-settings', async (req: Request, res: Response) => {
  try {
    const result = await query(
      `SELECT aws_access_key_id_encrypted, aws_region, aws_credentials_set_at,
              aws_in_sandbox, aws_quota_max_24h, aws_quota_max_send_rate, aws_quota_checked_at
       FROM workspaces WHERE id = $1`,
      [req.user!.workspaceId]
    );
    if (result.rows.length === 0) { res.status(404).json({ error: 'Workspace not found' }); return; }
    const ws = result.rows[0];

    res.json({
      configured: !!ws.aws_access_key_id_encrypted,
      access_key_id_masked: ws.aws_access_key_id_encrypted ? mask(ws.aws_access_key_id_encrypted.substring(0, 20)) : null,
      region: ws.aws_region,
      set_at: ws.aws_credentials_set_at,
      in_sandbox: ws.aws_in_sandbox,
      quota: ws.aws_quota_max_24h ? {
        max_24_hour: ws.aws_quota_max_24h,
        max_send_rate: ws.aws_quota_max_send_rate,
        checked_at: ws.aws_quota_checked_at,
      } : null,
    });
  } catch (err: any) {
    console.error('Get AWS settings error:', err);
    res.status(500).json({ error: 'Failed to fetch AWS settings' });
  }
});

// Save workspace AWS credentials (encrypted at rest)
router.post('/aws-settings', async (req: Request, res: Response) => {
  try {
    const { access_key_id, secret_access_key, region } = req.body;

    if (!access_key_id || !secret_access_key) {
      res.status(400).json({ error: 'access_key_id and secret_access_key are required' });
      return;
    }
    if (typeof access_key_id !== 'string' || access_key_id.length < 16 || access_key_id.length > 128) {
      res.status(400).json({ error: 'Invalid access_key_id format' });
      return;
    }
    if (typeof secret_access_key !== 'string' || secret_access_key.length < 16 || secret_access_key.length > 256) {
      res.status(400).json({ error: 'Invalid secret_access_key format' });
      return;
    }
    const validRegions = ['us-east-1', 'us-east-2', 'us-west-1', 'us-west-2', 'eu-west-1', 'eu-west-2', 'eu-west-3', 'eu-central-1', 'ap-south-1', 'ap-southeast-1', 'ap-southeast-2', 'ap-northeast-1', 'ap-northeast-2', 'sa-east-1', 'ca-central-1'];
    const finalRegion = region || 'us-east-1';
    if (!validRegions.includes(finalRegion)) {
      res.status(400).json({ error: `Invalid region. Must be one of: ${validRegions.join(', ')}` });
      return;
    }

    await query(
      `UPDATE workspaces SET
         aws_access_key_id_encrypted = $1,
         aws_secret_access_key_encrypted = $2,
         aws_region = $3,
         aws_credentials_set_at = NOW(),
         aws_quota_checked_at = NULL
       WHERE id = $4`,
      [encrypt(access_key_id), encrypt(secret_access_key), finalRegion, req.user!.workspaceId]
    );
    invalidateSESClientCache(req.user!.workspaceId);

    // Try to immediately fetch quota to validate credentials
    try {
      const quota = await getSendingQuota(req.user!.workspaceId);
      await query(
        `UPDATE workspaces SET
           aws_in_sandbox = $1, aws_quota_max_24h = $2, aws_quota_max_send_rate = $3,
           aws_quota_checked_at = NOW()
         WHERE id = $4`,
        [quota.inSandbox, quota.max24HourSend, quota.maxSendRate, req.user!.workspaceId]
      );
      res.json({ saved: true, quota, in_sandbox: quota.inSandbox });
    } catch (verifyErr: any) {
      // Credentials saved but couldn't validate — still tell user it was saved
      res.json({
        saved: true,
        warning: `Credentials saved, but couldn't validate with AWS: ${verifyErr.message}. Check the keys and region are correct.`,
      });
    }
  } catch (err: any) {
    console.error('Save AWS settings error:', err);
    res.status(500).json({ error: 'Failed to save AWS settings' });
  }
});

// Refresh quota / sandbox status from AWS
router.post('/aws-settings/refresh-quota', async (req: Request, res: Response) => {
  try {
    const quota = await getSendingQuota(req.user!.workspaceId);
    await query(
      `UPDATE workspaces SET
         aws_in_sandbox = $1, aws_quota_max_24h = $2, aws_quota_max_send_rate = $3,
         aws_quota_checked_at = NOW()
       WHERE id = $4`,
      [quota.inSandbox, quota.max24HourSend, quota.maxSendRate, req.user!.workspaceId]
    );
    res.json({ quota, in_sandbox: quota.inSandbox });
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'Failed to fetch SES quota' });
  }
});

// Delete workspace AWS credentials
router.delete('/aws-settings', async (req: Request, res: Response) => {
  try {
    await query(
      `UPDATE workspaces SET
         aws_access_key_id_encrypted = NULL,
         aws_secret_access_key_encrypted = NULL,
         aws_credentials_set_at = NULL
       WHERE id = $1`,
      [req.user!.workspaceId]
    );
    invalidateSESClientCache(req.user!.workspaceId);
    res.json({ deleted: true });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to delete credentials' });
  }
});

// ════════════════════════════════════════════════════════════
// MAILBOXES (verified senders)
// ════════════════════════════════════════════════════════════

// List all mailboxes
router.get('/', async (req: Request, res: Response) => {
  try {
    const result = await query(
      `SELECT id, from_email, from_name, reply_to_email, status, daily_send_limit, daily_sent_count,
         total_sent_count, last_used_at, is_default, is_active, signature_html,
         created_at, updated_at, last_verification_check_at
       FROM mailboxes WHERE workspace_id = $1
       ORDER BY is_default DESC, created_at ASC`,
      [req.user!.workspaceId]
    );

    // Include workspace capacity summary
    const capacity = await getWorkspaceCapacity(req.user!.workspaceId);

    res.json({ mailboxes: result.rows, capacity });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to fetch mailboxes' });
  }
});

// Get one mailbox
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const result = await query(
      `SELECT * FROM mailboxes WHERE id = $1 AND workspace_id = $2`,
      [req.params.id, req.user!.workspaceId]
    );
    if (result.rows.length === 0) { res.status(404).json({ error: 'Mailbox not found' }); return; }
    res.json({ mailbox: result.rows[0] });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to fetch mailbox' });
  }
});

// Create new mailbox + start SES verification
router.post('/', async (req: Request, res: Response) => {
  try {
    const { from_email, from_name, reply_to_email, signature_html, daily_send_limit } = req.body;

    if (!from_email) { res.status(400).json({ error: 'from_email is required' }); return; }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(from_email)) {
      res.status(400).json({ error: 'Invalid email format' });
      return;
    }
    if (reply_to_email && !emailRegex.test(reply_to_email)) {
      res.status(400).json({ error: 'Invalid reply_to_email format' });
      return;
    }

    // Check workspace has AWS credentials
    const ws = await query(
      'SELECT aws_access_key_id_encrypted FROM workspaces WHERE id = $1',
      [req.user!.workspaceId]
    );
    if (!ws.rows[0]?.aws_access_key_id_encrypted) {
      res.status(400).json({
        error: 'AWS credentials not configured. Set them in Settings → Email Sending → AWS Credentials first.',
      });
      return;
    }

    // Check no duplicate
    const existing = await query(
      'SELECT id FROM mailboxes WHERE workspace_id = $1 AND from_email = $2',
      [req.user!.workspaceId, from_email]
    );
    if (existing.rows.length > 0) {
      res.status(409).json({ error: 'A mailbox with this email already exists in your workspace' });
      return;
    }

    // Initiate SES verification
    try {
      await verifyEmailIdentity(req.user!.workspaceId, from_email);
    } catch (sesErr: any) {
      res.status(400).json({ error: `SES verification failed to start: ${sesErr.message}` });
      return;
    }

    // Insert mailbox row
    const result = await query(
      `INSERT INTO mailboxes (workspace_id, from_email, from_name, reply_to_email,
         signature_html, daily_send_limit, status, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, 'pending', $7) RETURNING *`,
      [
        req.user!.workspaceId, from_email, from_name || null, reply_to_email || null,
        signature_html || null, daily_send_limit || 50, req.user!.userId,
      ]
    );

    res.status(201).json({
      mailbox: result.rows[0],
      message: `Verification email sent to ${from_email}. Click the link in that email to activate this sender. Until then, this mailbox cannot send.`,
    });
  } catch (err: any) {
    console.error('Create mailbox error:', err);
    res.status(500).json({ error: err.message || 'Failed to create mailbox' });
  }
});

// Update mailbox (settings only — can't change from_email)
router.put('/:id', async (req: Request, res: Response) => {
  try {
    const { from_name, reply_to_email, signature_html, daily_send_limit, is_active } = req.body;
    const result = await query(
      `UPDATE mailboxes SET
         from_name = COALESCE($1, from_name),
         reply_to_email = COALESCE($2, reply_to_email),
         signature_html = COALESCE($3, signature_html),
         daily_send_limit = COALESCE($4, daily_send_limit),
         is_active = COALESCE($5, is_active)
       WHERE id = $6 AND workspace_id = $7 RETURNING *`,
      [from_name, reply_to_email, signature_html, daily_send_limit, is_active, req.params.id, req.user!.workspaceId]
    );
    if (result.rows.length === 0) { res.status(404).json({ error: 'Mailbox not found' }); return; }
    res.json({ mailbox: result.rows[0] });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to update mailbox' });
  }
});

// Set default mailbox
router.post('/:id/set-default', async (req: Request, res: Response) => {
  try {
    await query(
      `UPDATE mailboxes SET is_default = (id = $1) WHERE workspace_id = $2`,
      [req.params.id, req.user!.workspaceId]
    );
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to set default' });
  }
});

// Manually re-check SES verification status
router.post('/:id/check-verification', async (req: Request, res: Response) => {
  try {
    const mailbox = await query<{ from_email: string; status: string }>(
      'SELECT from_email, status FROM mailboxes WHERE id = $1 AND workspace_id = $2',
      [req.params.id, req.user!.workspaceId]
    );
    if (mailbox.rows.length === 0) { res.status(404).json({ error: 'Mailbox not found' }); return; }
    const email = mailbox.rows[0].from_email;

    const statuses = await checkVerificationStatus(req.user!.workspaceId, [email]);
    const sesStatus = statuses[email] || 'NotStarted';

    let dbStatus: string;
    if (sesStatus === 'Success') dbStatus = 'verified';
    else if (sesStatus === 'Failed') dbStatus = 'failed';
    else dbStatus = 'pending';

    await query(
      `UPDATE mailboxes SET status = $1, last_verification_check_at = NOW(),
         verification_attributes = $2 WHERE id = $3`,
      [dbStatus, JSON.stringify({ ses_status: sesStatus }), req.params.id]
    );

    res.json({ status: dbStatus, ses_status: sesStatus });
  } catch (err: any) {
    console.error('Check verification error:', err);
    res.status(400).json({ error: err.message || 'Failed to check verification' });
  }
});

// Resend SES verification email
router.post('/:id/resend-verification', async (req: Request, res: Response) => {
  try {
    const mailbox = await query<{ from_email: string }>(
      'SELECT from_email FROM mailboxes WHERE id = $1 AND workspace_id = $2',
      [req.params.id, req.user!.workspaceId]
    );
    if (mailbox.rows.length === 0) { res.status(404).json({ error: 'Mailbox not found' }); return; }

    await verifyEmailIdentity(req.user!.workspaceId, mailbox.rows[0].from_email);
    res.json({ ok: true, message: `Verification email re-sent to ${mailbox.rows[0].from_email}` });
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'Failed to resend verification' });
  }
});

// Delete mailbox + remove SES identity
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const mailbox = await query<{ from_email: string; is_default: boolean }>(
      'SELECT from_email, is_default FROM mailboxes WHERE id = $1 AND workspace_id = $2',
      [req.params.id, req.user!.workspaceId]
    );
    if (mailbox.rows.length === 0) { res.status(404).json({ error: 'Mailbox not found' }); return; }
    if (mailbox.rows[0].is_default) {
      const otherCount = await query(
        'SELECT COUNT(*) FROM mailboxes WHERE workspace_id = $1 AND id != $2',
        [req.user!.workspaceId, req.params.id]
      );
      if (parseInt(otherCount.rows[0].count) > 0) {
        res.status(400).json({ error: 'Cannot delete the default mailbox. Set another as default first.' });
        return;
      }
    }

    // Best-effort SES cleanup
    try {
      await deleteIdentity(req.user!.workspaceId, mailbox.rows[0].from_email);
    } catch { /* ignore */ }

    await query('DELETE FROM mailboxes WHERE id = $1', [req.params.id]);
    res.json({ deleted: true });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to delete mailbox' });
  }
});

export default router;
