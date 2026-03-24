import { Router, Request, Response } from 'express';
import bcrypt from 'bcrypt';
import jwt, { Secret, SignOptions } from 'jsonwebtoken';
import { query, transaction } from '../config/database';
import { config } from '../config';
import { authMiddleware } from '../middleware/auth';
import { validate } from '../middleware/validation';
import { User, Workspace } from '../types';

const router = Router();

router.post(
  '/register',
  validate([
    { field: 'email', required: true, type: 'email' },
    { field: 'password', required: true, type: 'string', minLength: 8, maxLength: 128 },
    { field: 'name', required: true, type: 'string', minLength: 1, maxLength: 255 },
    { field: 'workspaceName', required: true, type: 'string', minLength: 1, maxLength: 255 },
  ]),
  async (req: Request, res: Response) => {
    try {
      const { email, password, name, workspaceName } = req.body;
      const normalizedEmail = email.trim().toLowerCase();

      const existing = await query('SELECT id FROM users WHERE email = $1', [normalizedEmail]);
      if (existing.rows.length > 0) {
        res.status(409).json({ error: 'Email already registered' });
        return;
      }

      const passwordHash = await bcrypt.hash(password, 12);

      const result = await transaction(async (client) => {
        const ws = await client.query<Workspace>(
          `INSERT INTO workspaces (name) VALUES ($1) RETURNING *`,
          [workspaceName]
        );
        const workspace = ws.rows[0];

        const u = await client.query<User>(
          `INSERT INTO users (email, password_hash, name, role, workspace_id)
           VALUES ($1, $2, $3, 'owner', $4) RETURNING id, email, name, role, workspace_id, created_at`,
          [normalizedEmail, passwordHash, name, workspace.id]
        );
        return { user: u.rows[0], workspace };
      });

      const jwtSecret: Secret = String(config.jwt.secret);
const jwtOptions: SignOptions = {
  expiresIn: Number.isNaN(Number(config.jwt.expiresIn))
    ? (String(config.jwt.expiresIn) as SignOptions['expiresIn'])
    : Number(config.jwt.expiresIn),
};

const token = jwt.sign(
  {
    userId: result.user.id,
    workspaceId: result.workspace.id,
    email: result.user.email,
    role: result.user.role,
  },
  jwtSecret,
  jwtOptions
);

      res.status(201).json({
        token,
        user: result.user,
        workspace: { id: result.workspace.id, name: result.workspace.name },
      });
    } catch (err: any) {
      console.error('Register error:', err);
      res.status(500).json({ error: 'Registration failed' });
    }
  }
);

router.post(
  '/login',
  validate([
    { field: 'email', required: true, type: 'email' },
    { field: 'password', required: true, type: 'string' },
  ]),
  async (req: Request, res: Response) => {
    try {
      const { email, password } = req.body;
      const normalizedEmail = email.trim().toLowerCase();

      const result = await query<User & { password_hash: string }>(
        'SELECT * FROM users WHERE email = $1 AND is_active = TRUE',
        [normalizedEmail]
      );

      if (result.rows.length === 0) {
        res.status(401).json({ error: 'Invalid email or password' });
        return;
      }

      const user = result.rows[0];
      const valid = await bcrypt.compare(password, user.password_hash);
      if (!valid) {
        res.status(401).json({ error: 'Invalid email or password' });
        return;
      }

      await query('UPDATE users SET last_login_at = NOW() WHERE id = $1', [user.id]);

     const jwtSecret: Secret = String(config.jwt.secret);
const jwtOptions: SignOptions = {
  expiresIn: Number.isNaN(Number(config.jwt.expiresIn))
    ? (String(config.jwt.expiresIn) as SignOptions['expiresIn'])
    : Number(config.jwt.expiresIn),
};

const token = jwt.sign(
  {
    userId: user.id,
    workspaceId: user.workspace_id,
    email: user.email,
    role: user.role,
  },
  jwtSecret,
  jwtOptions
);

      let workspace = null;
      if (user.workspace_id) {
        const ws = await query('SELECT id, name, domain, daily_send_limit FROM workspaces WHERE id = $1', [user.workspace_id]);
        if (ws.rows.length > 0) workspace = ws.rows[0];
      }

      res.json({
        token,
        user: { id: user.id, email: user.email, name: user.name, role: user.role, workspace_id: user.workspace_id },
        workspace,
      });
    } catch (err: any) {
      console.error('Login error:', err);
      res.status(500).json({ error: 'Login failed' });
    }
  }
);

router.get('/me', authMiddleware, async (req: Request, res: Response) => {
  try {
    const result = await query(
      'SELECT id, email, name, role, workspace_id, created_at FROM users WHERE id = $1',
      [req.user!.userId]
    );
    if (result.rows.length === 0) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    let workspace = null;
    if (result.rows[0].workspace_id) {
      const ws = await query('SELECT * FROM workspaces WHERE id = $1', [result.rows[0].workspace_id]);
      if (ws.rows.length > 0) workspace = ws.rows[0];
    }

    res.json({ user: result.rows[0], workspace });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to fetch user' });
  }
});

router.put('/workspace', authMiddleware, async (req: Request, res: Response) => {
  try {
    const { name, domain, ses_from_email, ses_from_name, ses_config_set, daily_send_limit } = req.body;
    const wsId = req.user!.workspaceId;

    const result = await query(
      `UPDATE workspaces SET
        name = COALESCE($1, name),
        domain = COALESCE($2, domain),
        ses_from_email = COALESCE($3, ses_from_email),
        ses_from_name = COALESCE($4, ses_from_name),
        ses_config_set = COALESCE($5, ses_config_set),
        daily_send_limit = COALESCE($6, daily_send_limit)
       WHERE id = $7 RETURNING *`,
      [name, domain, ses_from_email, ses_from_name, ses_config_set, daily_send_limit, wsId]
    );

    res.json({ workspace: result.rows[0] });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to update workspace' });
  }
});

export default router;
