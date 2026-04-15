-- ============================================================
-- MIGRATION 002 — Apollo-style Sequence Features
-- Adds: tasks, snippets, A/B testing, business-day delays,
--       send windows, throttling, sequence templates,
--       multi-channel steps, dynamic enrollment triggers
-- ============================================================

BEGIN;

-- ─── EXTEND SEQUENCES TABLE ───────────────────────────
ALTER TABLE sequences
  ADD COLUMN IF NOT EXISTS daily_send_limit INT DEFAULT 100,
  ADD COLUMN IF NOT EXISTS hourly_send_limit INT DEFAULT 30,
  ADD COLUMN IF NOT EXISTS skip_weekends BOOLEAN DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS auto_pause_on_reply BOOLEAN DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS auto_pause_on_meeting BOOLEAN DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS owner_id UUID REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS is_template BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS cloned_from UUID REFERENCES sequences(id),
  ADD COLUMN IF NOT EXISTS total_enrolled INT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_completed INT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_replied INT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_meetings INT DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_sequences_owner ON sequences(owner_id);
CREATE INDEX IF NOT EXISTS idx_sequences_template ON sequences(workspace_id, is_template) WHERE is_template = TRUE;

-- ─── EXTEND SEQUENCE_STEPS TABLE ──────────────────────
ALTER TABLE sequence_steps
  ADD COLUMN IF NOT EXISTS step_name VARCHAR(255),
  ADD COLUMN IF NOT EXISTS delay_business_days INT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS delay_minutes INT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS task_type VARCHAR(50),  -- 'call','linkedin_view','linkedin_connect','linkedin_message','custom'
  ADD COLUMN IF NOT EXISTS task_instructions TEXT,
  ADD COLUMN IF NOT EXISTS task_priority VARCHAR(20) DEFAULT 'normal',  -- 'low','normal','high'
  ADD COLUMN IF NOT EXISTS assignee_role VARCHAR(50) DEFAULT 'owner',  -- who gets the task
  ADD COLUMN IF NOT EXISTS ab_test_enabled BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS ab_winner_variant_id UUID,
  ADD COLUMN IF NOT EXISTS use_spintax BOOLEAN DEFAULT FALSE;

-- Allow new step_types: email, delay, condition, call, linkedin, task
ALTER TABLE sequence_steps DROP CONSTRAINT IF EXISTS sequence_steps_step_type_check;
ALTER TABLE sequence_steps ADD CONSTRAINT sequence_steps_step_type_check
  CHECK (step_type IN ('email','delay','condition','call','linkedin','task'));

-- ─── EXTEND SEQUENCE_ENROLLMENTS TABLE ────────────────
ALTER TABLE sequence_enrollments
  ADD COLUMN IF NOT EXISTS pause_reason VARCHAR(100),
  ADD COLUMN IF NOT EXISTS paused_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS meeting_booked_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_activity_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS enrollment_source VARCHAR(50) DEFAULT 'manual';  -- 'manual','csv','filter','trigger','api'

-- ─── A/B TEST VARIANTS ────────────────────────────────
CREATE TABLE IF NOT EXISTS ab_variants (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    step_id         UUID NOT NULL REFERENCES sequence_steps(id) ON DELETE CASCADE,
    variant_label   VARCHAR(20) NOT NULL,  -- 'A','B','C'
    subject         VARCHAR(500),
    template_id     UUID REFERENCES templates(id),
    weight          INT DEFAULT 50,         -- percentage allocation 0-100
    sent_count      INT DEFAULT 0,
    open_count      INT DEFAULT 0,
    click_count     INT DEFAULT 0,
    reply_count     INT DEFAULT 0,
    is_winner       BOOLEAN DEFAULT FALSE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(step_id, variant_label)
);

CREATE INDEX idx_ab_variants_step ON ab_variants(step_id);

-- ─── TASKS (Calls, LinkedIn, Custom) ──────────────────
CREATE TABLE IF NOT EXISTS tasks (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    workspace_id        UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    enrollment_id       UUID REFERENCES sequence_enrollments(id) ON DELETE SET NULL,
    sequence_id         UUID REFERENCES sequences(id) ON DELETE SET NULL,
    step_id             UUID REFERENCES sequence_steps(id) ON DELETE SET NULL,
    contact_id          UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
    assigned_to         UUID REFERENCES users(id),
    task_type           VARCHAR(50) NOT NULL,  -- 'call','linkedin_view','linkedin_connect','linkedin_message','email_manual','custom'
    title               VARCHAR(500) NOT NULL,
    instructions        TEXT,
    priority            VARCHAR(20) NOT NULL DEFAULT 'normal' CHECK (priority IN ('low','normal','high','urgent')),
    status              VARCHAR(30) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','in_progress','completed','skipped','failed')),
    due_at              TIMESTAMPTZ,
    completed_at        TIMESTAMPTZ,
    completion_outcome  VARCHAR(50),  -- for calls: 'connected','voicemail','no_answer','wrong_number'; for linkedin: 'sent','accepted','ignored'
    completion_notes    TEXT,
    metadata            JSONB DEFAULT '{}',
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_tasks_workspace ON tasks(workspace_id);
CREATE INDEX idx_tasks_assigned ON tasks(assigned_to, status);
CREATE INDEX idx_tasks_contact ON tasks(contact_id);
CREATE INDEX idx_tasks_enrollment ON tasks(enrollment_id);
CREATE INDEX idx_tasks_status ON tasks(workspace_id, status);
CREATE INDEX idx_tasks_due ON tasks(due_at) WHERE status = 'pending';

CREATE TRIGGER set_updated_at_tasks BEFORE UPDATE ON tasks FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ─── SNIPPETS (Reusable content blocks) ───────────────
CREATE TABLE IF NOT EXISTS snippets (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    workspace_id    UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    name            VARCHAR(255) NOT NULL,
    shortcut        VARCHAR(50),  -- e.g. "intro" → typed as {{snippet:intro}}
    content         TEXT NOT NULL,
    content_html    TEXT,
    category        VARCHAR(100) DEFAULT 'general',
    use_count       INT DEFAULT 0,
    created_by      UUID REFERENCES users(id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(workspace_id, shortcut)
);

CREATE INDEX idx_snippets_workspace ON snippets(workspace_id);
CREATE INDEX idx_snippets_shortcut ON snippets(workspace_id, shortcut);

CREATE TRIGGER set_updated_at_snippets BEFORE UPDATE ON snippets FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ─── ENROLLMENT TRIGGERS (auto-enroll on conditions) ──
CREATE TABLE IF NOT EXISTS enrollment_triggers (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    workspace_id    UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    sequence_id     UUID NOT NULL REFERENCES sequences(id) ON DELETE CASCADE,
    name            VARCHAR(255) NOT NULL,
    trigger_type    VARCHAR(50) NOT NULL,  -- 'tag_added','source_match','custom_field','schedule'
    conditions      JSONB NOT NULL DEFAULT '{}',  -- e.g. {"tag":"hot-lead"} or {"source":"linkedin"}
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    last_run_at     TIMESTAMPTZ,
    enrollments_created INT DEFAULT 0,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_triggers_workspace ON enrollment_triggers(workspace_id);
CREATE INDEX idx_triggers_active ON enrollment_triggers(is_active) WHERE is_active = TRUE;

CREATE TRIGGER set_updated_at_triggers BEFORE UPDATE ON enrollment_triggers FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ─── SEQUENCE TEMPLATES LIBRARY (pre-built) ───────────
CREATE TABLE IF NOT EXISTS sequence_template_library (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name            VARCHAR(255) NOT NULL,
    description     TEXT,
    category        VARCHAR(100) NOT NULL,  -- 'cold_outreach','follow_up','nurture','re_engagement'
    industry        VARCHAR(100),
    step_count      INT DEFAULT 0,
    is_public       BOOLEAN DEFAULT TRUE,
    template_data   JSONB NOT NULL,         -- full sequence + steps definition
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_template_library_category ON sequence_template_library(category) WHERE is_public = TRUE;

-- Seed with 4 starter templates
INSERT INTO sequence_template_library (name, description, category, step_count, template_data) VALUES
('Cold Outreach — 5 Steps', '5-step cold email sequence with follow-ups, business day delays', 'cold_outreach', 5,
 '{"steps":[
   {"order":1,"type":"email","name":"Intro","delay_days":0,"subject":"Quick question, {{first_name}}"},
   {"order":2,"type":"email","name":"Value follow-up","delay_business_days":3,"subject":"Re: Quick question"},
   {"order":3,"type":"email","name":"Case study","delay_business_days":4,"subject":"Thought you''d like this — {{company}}"},
   {"order":4,"type":"email","name":"Breakup attempt","delay_business_days":5,"subject":"Closing the loop"},
   {"order":5,"type":"email","name":"Final touch","delay_business_days":7,"subject":"One last try"}
 ]}'::jsonb),
('Multi-channel Sequence', 'Email + LinkedIn + Call combo for high-value prospects', 'cold_outreach', 6,
 '{"steps":[
   {"order":1,"type":"email","name":"Intro email","delay_days":0,"subject":"Quick question, {{first_name}}"},
   {"order":2,"type":"linkedin","task_type":"linkedin_view","name":"View LinkedIn","delay_business_days":1},
   {"order":3,"type":"linkedin","task_type":"linkedin_connect","name":"Connect on LinkedIn","delay_business_days":2},
   {"order":4,"type":"email","name":"Email follow-up","delay_business_days":3,"subject":"Re: Quick question"},
   {"order":5,"type":"call","name":"Cold call","delay_business_days":4},
   {"order":6,"type":"email","name":"Breakup","delay_business_days":5,"subject":"Closing the loop"}
 ]}'::jsonb),
('Demo Follow-up', '4-step nurture after a demo or meeting', 'follow_up', 4,
 '{"steps":[
   {"order":1,"type":"email","name":"Thank you","delay_days":0,"subject":"Thanks for the conversation, {{first_name}}"},
   {"order":2,"type":"email","name":"Resources","delay_business_days":2,"subject":"Resources from our chat"},
   {"order":3,"type":"email","name":"Check-in","delay_business_days":5,"subject":"Any questions, {{first_name}}?"},
   {"order":4,"type":"email","name":"Next steps","delay_business_days":7,"subject":"Ready to move forward?"}
 ]}'::jsonb),
('Re-engagement', '3-step sequence for cold leads', 're_engagement', 3,
 '{"steps":[
   {"order":1,"type":"email","name":"Reconnect","delay_days":0,"subject":"Long time no talk, {{first_name}}"},
   {"order":2,"type":"email","name":"Update","delay_business_days":3,"subject":"What''s new at {{company}}?"},
   {"order":3,"type":"email","name":"Final attempt","delay_business_days":5,"subject":"Should I close your file?"}
 ]}'::jsonb);

-- ─── ACTIVITY LOG (audit trail + sequence history) ────
CREATE TABLE IF NOT EXISTS activity_log (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    workspace_id    UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    user_id         UUID REFERENCES users(id),
    contact_id      UUID REFERENCES contacts(id) ON DELETE SET NULL,
    sequence_id     UUID REFERENCES sequences(id) ON DELETE SET NULL,
    enrollment_id   UUID REFERENCES sequence_enrollments(id) ON DELETE SET NULL,
    action          VARCHAR(100) NOT NULL,  -- 'enrolled','step_executed','paused','reply_received','meeting_booked','task_completed'
    description     TEXT,
    metadata        JSONB DEFAULT '{}',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_activity_workspace ON activity_log(workspace_id, created_at DESC);
CREATE INDEX idx_activity_contact ON activity_log(contact_id, created_at DESC);
CREATE INDEX idx_activity_sequence ON activity_log(sequence_id, created_at DESC);
CREATE INDEX idx_activity_action ON activity_log(workspace_id, action);

-- ─── SEQUENCE THROTTLE TRACKER (per workspace per hour) ─
CREATE TABLE IF NOT EXISTS send_throttle (
    workspace_id    UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    sequence_id     UUID REFERENCES sequences(id) ON DELETE CASCADE,
    bucket_hour     TIMESTAMPTZ NOT NULL,
    sent_count      INT DEFAULT 0,
    PRIMARY KEY (workspace_id, sequence_id, bucket_hour)
);

CREATE INDEX idx_throttle_lookup ON send_throttle(workspace_id, bucket_hour);

COMMIT;
