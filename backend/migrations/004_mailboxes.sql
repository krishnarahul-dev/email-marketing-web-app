-- ============================================================
-- MIGRATION 004 — Multi-mailbox AWS SES Support
-- Adds: mailboxes table, per-workspace AWS credentials,
--       per-mailbox verification status + daily send tracking
-- ============================================================

BEGIN;

-- ─── WORKSPACE-LEVEL AWS CREDENTIALS (encrypted) ─────
ALTER TABLE workspaces
  ADD COLUMN IF NOT EXISTS aws_access_key_id_encrypted TEXT,
  ADD COLUMN IF NOT EXISTS aws_secret_access_key_encrypted TEXT,
  ADD COLUMN IF NOT EXISTS aws_region VARCHAR(50) DEFAULT 'us-east-1',
  ADD COLUMN IF NOT EXISTS aws_credentials_set_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS aws_in_sandbox BOOLEAN DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS aws_quota_max_24h INT,
  ADD COLUMN IF NOT EXISTS aws_quota_max_send_rate NUMERIC(8,2),
  ADD COLUMN IF NOT EXISTS aws_quota_checked_at TIMESTAMPTZ;

-- ─── MAILBOXES TABLE ─────────────────────────────────
-- One row per verified sender identity in a workspace.
-- All mailboxes share the workspace's AWS credentials.
CREATE TABLE IF NOT EXISTS mailboxes (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    workspace_id        UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    -- Sender identity
    from_email          VARCHAR(320) NOT NULL,
    from_name           VARCHAR(255),
    reply_to_email      VARCHAR(320),
    -- Provider (always 'ses' for now; future-proof for sendgrid, postmark, etc.)
    provider            VARCHAR(30) NOT NULL DEFAULT 'ses' CHECK (provider IN ('ses')),
    -- SES verification status
    status              VARCHAR(30) NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending','verified','failed','disabled')),
    verification_attributes JSONB DEFAULT '{}',  -- raw SES GetIdentityVerificationAttributes response
    last_verification_check_at TIMESTAMPTZ,
    -- Send limits and tracking
    daily_send_limit    INT NOT NULL DEFAULT 50,
    daily_sent_count    INT NOT NULL DEFAULT 0,
    daily_count_reset_at DATE NOT NULL DEFAULT CURRENT_DATE,
    total_sent_count    BIGINT NOT NULL DEFAULT 0,
    last_used_at        TIMESTAMPTZ,
    -- Lifecycle
    is_default          BOOLEAN NOT NULL DEFAULT FALSE,
    is_active           BOOLEAN NOT NULL DEFAULT TRUE,
    signature_html      TEXT,
    created_by          UUID REFERENCES users(id),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(workspace_id, from_email)
);

CREATE INDEX idx_mailboxes_workspace ON mailboxes(workspace_id);
CREATE INDEX idx_mailboxes_active ON mailboxes(workspace_id, is_active, status) WHERE is_active = TRUE;
-- Round-robin selector index: pick mailbox with oldest last_used_at and capacity remaining
CREATE INDEX idx_mailboxes_rotation ON mailboxes(workspace_id, last_used_at NULLS FIRST)
    WHERE is_active = TRUE AND status = 'verified';

CREATE TRIGGER set_updated_at_mailboxes BEFORE UPDATE ON mailboxes FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ─── EMAIL LOGS — TRACK WHICH MAILBOX SENT IT ────────
ALTER TABLE email_logs
  ADD COLUMN IF NOT EXISTS mailbox_id UUID REFERENCES mailboxes(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_email_logs_mailbox ON email_logs(mailbox_id);

-- ─── SEQUENCES — OPTIONAL MAILBOX OVERRIDE ───────────
-- If NULL, sequence uses round-robin across all workspace mailboxes.
-- If set, sequence sends only from this specific mailbox.
ALTER TABLE sequences
  ADD COLUMN IF NOT EXISTS preferred_mailbox_id UUID REFERENCES mailboxes(id) ON DELETE SET NULL;

-- ─── BACKFILL: Migrate existing ses_from_email to a mailbox row ──
INSERT INTO mailboxes (workspace_id, from_email, from_name, status, is_default, daily_send_limit)
SELECT id, ses_from_email, ses_from_name, 'verified', TRUE, COALESCE(daily_send_limit, 100)
FROM workspaces
WHERE ses_from_email IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM mailboxes m WHERE m.workspace_id = workspaces.id);

COMMIT;
