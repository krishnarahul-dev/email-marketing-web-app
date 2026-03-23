-- ============================================================
-- EMAIL MARKETING PLATFORM — FULL DATABASE SCHEMA
-- Migration 001: Initial Schema
-- ============================================================

BEGIN;

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================
-- USERS
-- ============================================================
CREATE TABLE users (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email           VARCHAR(320) UNIQUE NOT NULL,
    password_hash   VARCHAR(255) NOT NULL,
    name            VARCHAR(255) NOT NULL,
    role            VARCHAR(20) NOT NULL DEFAULT 'member' CHECK (role IN ('owner','admin','member')),
    workspace_id    UUID,
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    last_login_at   TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_workspace ON users(workspace_id);

-- ============================================================
-- WORKSPACES
-- ============================================================
CREATE TABLE workspaces (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name            VARCHAR(255) NOT NULL,
    domain          VARCHAR(255),
    ses_region      VARCHAR(50) DEFAULT 'us-east-1',
    ses_from_email  VARCHAR(320),
    ses_from_name   VARCHAR(255),
    ses_config_set  VARCHAR(255),
    daily_send_limit INT NOT NULL DEFAULT 200,
    warmup_enabled  BOOLEAN NOT NULL DEFAULT TRUE,
    warmup_day      INT NOT NULL DEFAULT 1,
    postmark_webhook_token VARCHAR(255),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE users ADD CONSTRAINT fk_users_workspace FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE SET NULL;

-- ============================================================
-- CONTACTS
-- ============================================================
CREATE TABLE contacts (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    workspace_id    UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    email           VARCHAR(320) NOT NULL,
    first_name      VARCHAR(255),
    last_name       VARCHAR(255),
    company         VARCHAR(255),
    title           VARCHAR(255),
    phone           VARCHAR(50),
    linkedin_url    VARCHAR(500),
    source          VARCHAR(100) DEFAULT 'manual',
    tags            TEXT[] DEFAULT '{}',
    custom_fields   JSONB DEFAULT '{}',
    status          VARCHAR(30) NOT NULL DEFAULT 'active' CHECK (status IN ('active','unsubscribed','bounced','complained','suppressed')),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(workspace_id, email)
);

CREATE INDEX idx_contacts_workspace ON contacts(workspace_id);
CREATE INDEX idx_contacts_email ON contacts(email);
CREATE INDEX idx_contacts_status ON contacts(workspace_id, status);
CREATE INDEX idx_contacts_source ON contacts(workspace_id, source);
CREATE INDEX idx_contacts_tags ON contacts USING GIN(tags);
CREATE INDEX idx_contacts_custom_fields ON contacts USING GIN(custom_fields);

-- ============================================================
-- CAMPAIGNS
-- ============================================================
CREATE TABLE campaigns (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    workspace_id    UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    name            VARCHAR(255) NOT NULL,
    subject         VARCHAR(500),
    template_id     UUID,
    status          VARCHAR(30) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','scheduled','sending','paused','completed','cancelled')),
    send_at         TIMESTAMPTZ,
    total_recipients INT DEFAULT 0,
    sent_count      INT DEFAULT 0,
    open_count      INT DEFAULT 0,
    click_count     INT DEFAULT 0,
    reply_count     INT DEFAULT 0,
    bounce_count    INT DEFAULT 0,
    created_by      UUID REFERENCES users(id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_campaigns_workspace ON campaigns(workspace_id);
CREATE INDEX idx_campaigns_status ON campaigns(workspace_id, status);

-- ============================================================
-- TEMPLATES
-- ============================================================
CREATE TABLE templates (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    workspace_id    UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    name            VARCHAR(255) NOT NULL,
    subject         VARCHAR(500),
    html_content    TEXT,
    design_json     JSONB,
    text_content    TEXT,
    category        VARCHAR(100) DEFAULT 'general',
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    created_by      UUID REFERENCES users(id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_templates_workspace ON templates(workspace_id);

-- ============================================================
-- TEMPLATE VERSIONS (immutable snapshots for sent emails)
-- ============================================================
CREATE TABLE template_versions (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    template_id     UUID NOT NULL REFERENCES templates(id) ON DELETE CASCADE,
    version_number  INT NOT NULL,
    subject         VARCHAR(500),
    html_content    TEXT NOT NULL,
    design_json     JSONB,
    text_content    TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(template_id, version_number)
);

CREATE INDEX idx_template_versions_template ON template_versions(template_id);

-- ============================================================
-- SEQUENCES
-- ============================================================
CREATE TABLE sequences (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    workspace_id    UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    name            VARCHAR(255) NOT NULL,
    description     TEXT,
    status          VARCHAR(30) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','active','paused','archived')),
    max_enrollments INT,
    send_window_start TIME DEFAULT '09:00:00',
    send_window_end TIME DEFAULT '17:00:00',
    send_timezone   VARCHAR(50) DEFAULT 'America/New_York',
    created_by      UUID REFERENCES users(id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_sequences_workspace ON sequences(workspace_id);
CREATE INDEX idx_sequences_status ON sequences(workspace_id, status);

-- ============================================================
-- SEQUENCE STEPS
-- ============================================================
CREATE TABLE sequence_steps (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    sequence_id     UUID NOT NULL REFERENCES sequences(id) ON DELETE CASCADE,
    step_order      INT NOT NULL,
    step_type       VARCHAR(30) NOT NULL CHECK (step_type IN ('email','delay','condition')),
    delay_days      INT DEFAULT 0,
    delay_hours     INT DEFAULT 0,
    template_id     UUID REFERENCES templates(id),
    subject_override VARCHAR(500),
    condition_type  VARCHAR(50),  -- 'reply_tone', 'opened', 'clicked', 'no_reply'
    condition_value VARCHAR(100), -- 'interested', 'not_interested', etc.
    parent_step_id  UUID REFERENCES sequence_steps(id),
    branch_label    VARCHAR(50),  -- 'positive', 'negative', 'default'
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX idx_sequence_steps_unique
ON sequence_steps (
    sequence_id,
    step_order,
    COALESCE(parent_step_id, '00000000-0000-0000-0000-000000000000'::uuid),
    COALESCE(branch_label, '__none__')
);

CREATE INDEX idx_sequence_steps_sequence ON sequence_steps(sequence_id);
CREATE INDEX idx_sequence_steps_parent ON sequence_steps(parent_step_id);

-- ============================================================
-- SEQUENCE ENROLLMENTS
-- ============================================================
CREATE TABLE sequence_enrollments (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    sequence_id     UUID NOT NULL REFERENCES sequences(id) ON DELETE CASCADE,
    contact_id      UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
    workspace_id    UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    current_step_id UUID REFERENCES sequence_steps(id),
    status          VARCHAR(30) NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused','completed','replied','unsubscribed','bounced','cancelled')),
    enrolled_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    next_send_at    TIMESTAMPTZ,
    completed_at    TIMESTAMPTZ,
    reply_tone      VARCHAR(50),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(sequence_id, contact_id)
);

CREATE INDEX idx_enrollments_sequence ON sequence_enrollments(sequence_id);
CREATE INDEX idx_enrollments_contact ON sequence_enrollments(contact_id);
CREATE INDEX idx_enrollments_status ON sequence_enrollments(status);
CREATE INDEX idx_enrollments_next_send ON sequence_enrollments(next_send_at) WHERE status = 'active';
CREATE INDEX idx_enrollments_workspace ON sequence_enrollments(workspace_id);

-- ============================================================
-- EMAIL LOGS
-- ============================================================
CREATE TABLE email_logs (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    workspace_id    UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    contact_id      UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
    campaign_id     UUID REFERENCES campaigns(id) ON DELETE SET NULL,
    sequence_id     UUID REFERENCES sequences(id) ON DELETE SET NULL,
    enrollment_id   UUID REFERENCES sequence_enrollments(id) ON DELETE SET NULL,
    step_id         UUID REFERENCES sequence_steps(id) ON DELETE SET NULL,
    template_version_id UUID REFERENCES template_versions(id),
    ses_message_id  VARCHAR(255),
    from_email      VARCHAR(320) NOT NULL,
    to_email        VARCHAR(320) NOT NULL,
    subject         VARCHAR(500),
    html_content    TEXT,
    status          VARCHAR(30) NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','sent','delivered','opened','clicked','replied','bounced','complained','failed')),
    sent_at         TIMESTAMPTZ,
    delivered_at    TIMESTAMPTZ,
    opened_at       TIMESTAMPTZ,
    clicked_at      TIMESTAMPTZ,
    replied_at      TIMESTAMPTZ,
    bounced_at      TIMESTAMPTZ,
    open_count      INT DEFAULT 0,
    click_count     INT DEFAULT 0,
    error_message   TEXT,
    metadata        JSONB DEFAULT '{}',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_email_logs_workspace ON email_logs(workspace_id);
CREATE INDEX idx_email_logs_contact ON email_logs(contact_id);
CREATE INDEX idx_email_logs_campaign ON email_logs(campaign_id);
CREATE INDEX idx_email_logs_sequence ON email_logs(sequence_id);
CREATE INDEX idx_email_logs_enrollment ON email_logs(enrollment_id);
CREATE INDEX idx_email_logs_ses_id ON email_logs(ses_message_id);
CREATE INDEX idx_email_logs_status ON email_logs(workspace_id, status);
CREATE INDEX idx_email_logs_sent_at ON email_logs(sent_at);

-- ============================================================
-- EMAIL EVENTS (granular tracking events)
-- ============================================================
CREATE TABLE email_events (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email_log_id    UUID NOT NULL REFERENCES email_logs(id) ON DELETE CASCADE,
    workspace_id    UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    event_type      VARCHAR(30) NOT NULL CHECK (event_type IN ('sent','delivered','opened','clicked','bounced','complained','unsubscribed','replied')),
    event_data      JSONB DEFAULT '{}',
    ip_address      VARCHAR(45),
    user_agent      TEXT,
    link_url        TEXT,
    occurred_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_email_events_log ON email_events(email_log_id);
CREATE INDEX idx_email_events_workspace ON email_events(workspace_id);
CREATE INDEX idx_email_events_type ON email_events(event_type);
CREATE INDEX idx_email_events_occurred ON email_events(occurred_at);

-- ============================================================
-- SUPPRESSION LIST
-- ============================================================
CREATE TABLE suppression_list (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    workspace_id    UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    email           VARCHAR(320) NOT NULL,
    reason          VARCHAR(50) NOT NULL CHECK (reason IN ('unsubscribe','bounce','complaint','manual','invalid')),
    source          VARCHAR(100),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(workspace_id, email)
);

CREATE INDEX idx_suppression_workspace ON suppression_list(workspace_id);
CREATE INDEX idx_suppression_email ON suppression_list(email);

-- ============================================================
-- REPLY MESSAGES
-- ============================================================
CREATE TABLE reply_messages (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    workspace_id    UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    contact_id      UUID REFERENCES contacts(id) ON DELETE SET NULL,
    email_log_id    UUID REFERENCES email_logs(id) ON DELETE SET NULL,
    enrollment_id   UUID REFERENCES sequence_enrollments(id) ON DELETE SET NULL,
    from_email      VARCHAR(320) NOT NULL,
    subject         VARCHAR(500),
    body_text       TEXT,
    body_html       TEXT,
    detected_tone   VARCHAR(50),
    tone_confidence DECIMAL(3,2),
    raw_headers     JSONB,
    postmark_message_id VARCHAR(255),
    processed       BOOLEAN NOT NULL DEFAULT FALSE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_replies_workspace ON reply_messages(workspace_id);
CREATE INDEX idx_replies_contact ON reply_messages(contact_id);
CREATE INDEX idx_replies_email_log ON reply_messages(email_log_id);
CREATE INDEX idx_replies_enrollment ON reply_messages(enrollment_id);
CREATE INDEX idx_replies_processed ON reply_messages(processed) WHERE processed = FALSE;

-- ============================================================
-- UPDATED_AT TRIGGER FUNCTION
-- ============================================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE 'plpgsql';

-- Apply updated_at triggers
CREATE TRIGGER set_updated_at_users BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER set_updated_at_workspaces BEFORE UPDATE ON workspaces FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER set_updated_at_contacts BEFORE UPDATE ON contacts FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER set_updated_at_campaigns BEFORE UPDATE ON campaigns FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER set_updated_at_templates BEFORE UPDATE ON templates FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER set_updated_at_sequences BEFORE UPDATE ON sequences FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER set_updated_at_sequence_steps BEFORE UPDATE ON sequence_steps FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER set_updated_at_enrollments BEFORE UPDATE ON sequence_enrollments FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

COMMIT;
