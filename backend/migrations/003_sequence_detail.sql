-- ============================================================
-- MIGRATION 003 — Sequence Detail Page Support
-- Adds: per-weekday schedules, computed contact engagement status,
--       sequence-level email body storage (inline editor)
-- ============================================================

BEGIN;

-- ─── PER-WEEKDAY SCHEDULE TABLE ──────────────────────
CREATE TABLE IF NOT EXISTS sequence_schedules (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    workspace_id    UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    name            VARCHAR(255) NOT NULL DEFAULT 'Normal Business Hours',
    timezone        VARCHAR(50) NOT NULL DEFAULT 'America/New_York',
    is_default      BOOLEAN NOT NULL DEFAULT FALSE,
    -- 7 weekday windows; NULL means "no sending that day"
    monday_start    TIME,
    monday_end      TIME,
    tuesday_start   TIME,
    tuesday_end     TIME,
    wednesday_start TIME,
    wednesday_end   TIME,
    thursday_start  TIME,
    thursday_end    TIME,
    friday_start    TIME,
    friday_end      TIME,
    saturday_start  TIME,
    saturday_end    TIME,
    sunday_start    TIME,
    sunday_end      TIME,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_schedules_workspace ON sequence_schedules(workspace_id);
CREATE INDEX idx_schedules_default ON sequence_schedules(workspace_id, is_default) WHERE is_default = TRUE;

CREATE TRIGGER set_updated_at_schedules BEFORE UPDATE ON sequence_schedules FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Seed default "Normal Business Hours" schedule per workspace
INSERT INTO sequence_schedules (workspace_id, name, timezone, is_default,
    monday_start, monday_end, tuesday_start, tuesday_end,
    wednesday_start, wednesday_end, thursday_start, thursday_end,
    friday_start, friday_end)
SELECT id, 'Normal Business Hours', COALESCE(NULLIF(ses_region, ''), 'America/New_York'), TRUE,
    '09:00', '17:00', '09:00', '17:00', '09:00', '17:00', '09:00', '17:00', '09:00', '17:00'
FROM workspaces
WHERE NOT EXISTS (
    SELECT 1 FROM sequence_schedules s WHERE s.workspace_id = workspaces.id AND s.is_default = TRUE
);

-- ─── LINK SEQUENCES TO SCHEDULES ─────────────────────
ALTER TABLE sequences
  ADD COLUMN IF NOT EXISTS schedule_id UUID REFERENCES sequence_schedules(id) ON DELETE SET NULL;

-- Backfill: link each sequence to the workspace's default schedule
UPDATE sequences s
SET schedule_id = (SELECT id FROM sequence_schedules WHERE workspace_id = s.workspace_id AND is_default = TRUE LIMIT 1)
WHERE schedule_id IS NULL;

-- ─── INLINE EMAIL BODY STORAGE PER STEP ──────────────
-- Apollo lets you write the email body INSIDE the step instead of using
-- a separate Template. Add columns to support both modes.
ALTER TABLE sequence_steps
  ADD COLUMN IF NOT EXISTS body_html TEXT,
  ADD COLUMN IF NOT EXISTS body_text TEXT,
  ADD COLUMN IF NOT EXISTS subject TEXT,
  ADD COLUMN IF NOT EXISTS thread_mode VARCHAR(20) DEFAULT 'new'
    CHECK (thread_mode IN ('new','reply')),
  ADD COLUMN IF NOT EXISTS include_signature BOOLEAN DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS reference_step_id UUID REFERENCES sequence_steps(id) ON DELETE SET NULL;

-- ─── COMPUTED CONTACT STATUS HELPER VIEW ─────────────
-- This view joins enrollment + email stats + contact data so the frontend
-- can filter contacts in a sequence by Cold/Approaching/Replied/etc.
CREATE OR REPLACE VIEW v_sequence_contact_status AS
SELECT
  se.id AS enrollment_id,
  se.sequence_id,
  se.contact_id,
  se.workspace_id,
  c.email,
  c.first_name,
  c.last_name,
  c.company,
  c.title,
  se.status AS enrollment_status,
  se.current_step_id,
  ss.step_order AS current_step_order,
  se.next_send_at,
  se.enrolled_at,
  se.last_activity_at,
  se.reply_tone,
  -- Computed engagement bucket
  CASE
    WHEN se.status = 'replied' THEN 'replied'
    WHEN se.status = 'bounced' THEN 'bounced'
    WHEN se.status = 'unsubscribed' THEN 'unsubscribed'
    WHEN se.status = 'completed' THEN 'finished'
    WHEN se.status = 'paused' THEN 'paused'
    WHEN se.next_send_at IS NOT NULL AND se.next_send_at <= NOW() + INTERVAL '24 hours' THEN 'approaching'
    WHEN (SELECT COUNT(*) FROM email_logs el WHERE el.enrollment_id = se.id AND el.opened_at IS NOT NULL) > 0 THEN 'engaged'
    WHEN (SELECT COUNT(*) FROM email_logs el WHERE el.enrollment_id = se.id AND el.sent_at IS NOT NULL) >= 3
         AND NOT EXISTS (SELECT 1 FROM email_logs el WHERE el.enrollment_id = se.id AND el.opened_at IS NOT NULL)
      THEN 'unresponsive'
    WHEN (SELECT COUNT(*) FROM email_logs el WHERE el.enrollment_id = se.id AND el.sent_at IS NOT NULL) > 0 THEN 'cold'
    ELSE 'not_started'
  END AS engagement_status,
  -- Per-enrollment email stats
  (SELECT COUNT(*) FROM email_logs el WHERE el.enrollment_id = se.id AND el.sent_at IS NOT NULL) AS emails_sent,
  (SELECT COUNT(*) FROM email_logs el WHERE el.enrollment_id = se.id AND el.opened_at IS NOT NULL) AS emails_opened,
  (SELECT COUNT(*) FROM email_logs el WHERE el.enrollment_id = se.id AND el.clicked_at IS NOT NULL) AS emails_clicked,
  (SELECT COUNT(*) FROM email_logs el WHERE el.enrollment_id = se.id AND el.replied_at IS NOT NULL) AS emails_replied
FROM sequence_enrollments se
JOIN contacts c ON c.id = se.contact_id
LEFT JOIN sequence_steps ss ON ss.id = se.current_step_id;

COMMIT;
