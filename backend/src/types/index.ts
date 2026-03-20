export interface User {
  id: string;
  email: string;
  name: string;
  role: 'owner' | 'admin' | 'member';
  workspace_id: string | null;
  is_active: boolean;
  last_login_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface Workspace {
  id: string;
  name: string;
  domain: string | null;
  ses_region: string;
  ses_from_email: string | null;
  ses_from_name: string | null;
  ses_config_set: string | null;
  daily_send_limit: number;
  warmup_enabled: boolean;
  warmup_day: number;
  postmark_webhook_token: string | null;
  created_at: string;
  updated_at: string;
}

export interface Contact {
  id: string;
  workspace_id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  company: string | null;
  title: string | null;
  phone: string | null;
  linkedin_url: string | null;
  source: string;
  tags: string[];
  custom_fields: Record<string, any>;
  status: 'active' | 'unsubscribed' | 'bounced' | 'complained' | 'suppressed';
  created_at: string;
  updated_at: string;
}

export interface Campaign {
  id: string;
  workspace_id: string;
  name: string;
  subject: string | null;
  template_id: string | null;
  status: 'draft' | 'scheduled' | 'sending' | 'paused' | 'completed' | 'cancelled';
  send_at: string | null;
  total_recipients: number;
  sent_count: number;
  open_count: number;
  click_count: number;
  reply_count: number;
  bounce_count: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface Template {
  id: string;
  workspace_id: string;
  name: string;
  subject: string | null;
  html_content: string | null;
  design_json: any;
  text_content: string | null;
  category: string;
  is_active: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface TemplateVersion {
  id: string;
  template_id: string;
  version_number: number;
  subject: string | null;
  html_content: string;
  design_json: any;
  text_content: string | null;
  created_at: string;
}

export interface Sequence {
  id: string;
  workspace_id: string;
  name: string;
  description: string | null;
  status: 'draft' | 'active' | 'paused' | 'archived';
  max_enrollments: number | null;
  send_window_start: string;
  send_window_end: string;
  send_timezone: string;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface SequenceStep {
  id: string;
  sequence_id: string;
  step_order: number;
  step_type: 'email' | 'delay' | 'condition';
  delay_days: number;
  delay_hours: number;
  template_id: string | null;
  subject_override: string | null;
  condition_type: string | null;
  condition_value: string | null;
  parent_step_id: string | null;
  branch_label: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface SequenceEnrollment {
  id: string;
  sequence_id: string;
  contact_id: string;
  workspace_id: string;
  current_step_id: string | null;
  status: 'active' | 'paused' | 'completed' | 'replied' | 'unsubscribed' | 'bounced' | 'cancelled';
  enrolled_at: string;
  next_send_at: string | null;
  completed_at: string | null;
  reply_tone: string | null;
  created_at: string;
  updated_at: string;
}

export interface EmailLog {
  id: string;
  workspace_id: string;
  contact_id: string;
  campaign_id: string | null;
  sequence_id: string | null;
  enrollment_id: string | null;
  step_id: string | null;
  template_version_id: string | null;
  ses_message_id: string | null;
  from_email: string;
  to_email: string;
  subject: string | null;
  html_content: string | null;
  status: string;
  sent_at: string | null;
  delivered_at: string | null;
  opened_at: string | null;
  clicked_at: string | null;
  replied_at: string | null;
  bounced_at: string | null;
  open_count: number;
  click_count: number;
  error_message: string | null;
  metadata: Record<string, any>;
  created_at: string;
}

export interface EmailEvent {
  id: string;
  email_log_id: string;
  workspace_id: string;
  event_type: string;
  event_data: Record<string, any>;
  ip_address: string | null;
  user_agent: string | null;
  link_url: string | null;
  occurred_at: string;
}

export interface ReplyMessage {
  id: string;
  workspace_id: string;
  contact_id: string | null;
  email_log_id: string | null;
  enrollment_id: string | null;
  from_email: string;
  subject: string | null;
  body_text: string | null;
  body_html: string | null;
  detected_tone: string | null;
  tone_confidence: number | null;
  raw_headers: any;
  postmark_message_id: string | null;
  processed: boolean;
  created_at: string;
}

export type ToneCategory = 'interested' | 'objection' | 'not_interested' | 'neutral' | 'unsubscribe' | 'out_of_office';

export interface ToneResult {
  category: ToneCategory;
  confidence: number;
  reasoning: string;
}

export interface JwtPayload {
  userId: string;
  workspaceId: string;
  email: string;
  role: string;
}

export interface PaginationParams {
  page: number;
  limit: number;
  offset: number;
}

export interface PaginatedResult<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface SendEmailParams {
  to: string;
  from: string;
  fromName?: string;
  subject: string;
  htmlBody: string;
  textBody?: string;
  configurationSet?: string;
  tags?: Record<string, string>;
  replyTo?: string;
}

export interface PersonalizationData {
  first_name?: string;
  last_name?: string;
  company?: string;
  title?: string;
  email?: string;
  [key: string]: string | undefined;
}
