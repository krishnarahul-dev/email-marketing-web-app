export interface User {
  id: string;
  email: string;
  name: string;
  role: string;
  workspace_id: string | null;
  created_at: string;
}

export interface Workspace {
  id: string;
  name: string;
  domain: string | null;
  ses_from_email: string | null;
  ses_from_name: string | null;
  ses_config_set: string | null;
  daily_send_limit: number;
}

export interface Contact {
  id: string;
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
}

export interface Campaign {
  id: string;
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
  created_at: string;
}

export interface Template {
  id: string;
  name: string;
  subject: string | null;
  html_content: string | null;
  design_json: any;
  text_content: string | null;
  category: string;
  created_at: string;
  updated_at: string;
}

export interface Sequence {
  id: string;
  name: string;
  description: string | null;
  status: 'draft' | 'active' | 'paused' | 'archived';
  send_window_start: string;
  send_window_end: string;
  send_timezone: string;
  created_at: string;
  enrollment_count?: number;
  active_enrollments?: number;
  step_count?: number;
}

export interface SequenceStep {
  id: string;
  sequence_id: string;
  step_order: number;
  step_type: 'email' | 'delay' | 'condition';
  delay_days: number;
  delay_hours: number;
  template_id: string | null;
  template_name?: string;
  subject_override: string | null;
  condition_type: string | null;
  condition_value: string | null;
  parent_step_id: string | null;
  branch_label: string | null;
  is_active: boolean;
}

export interface SequenceEnrollment {
  id: string;
  sequence_id: string;
  contact_id: string;
  status: string;
  enrolled_at: string;
  next_send_at: string | null;
  reply_tone: string | null;
  email?: string;
  first_name?: string;
  last_name?: string;
  company?: string;
}

export interface EmailLog {
  id: string;
  contact_id: string;
  campaign_id: string | null;
  sequence_id: string | null;
  to_email: string;
  subject: string;
  status: string;
  sent_at: string | null;
  opened_at: string | null;
  clicked_at: string | null;
  replied_at: string | null;
  open_count: number;
  click_count: number;
}

export interface ReplyMessage {
  id: string;
  from_email: string;
  subject: string | null;
  body_text: string | null;
  detected_tone: string | null;
  tone_confidence: number | null;
  first_name?: string;
  last_name?: string;
  company?: string;
  created_at: string;
}

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface DashboardOverview {
  contacts: { total: string; active: string; unsubscribed: string; bounced: string };
  campaigns: { total: string; sending: string; completed: string };
  sequences: { total: string; active: string; active_enrollments: string };
  emails: {
    total_sent: string; total_opened: string; total_clicked: string;
    total_replied: string; total_bounced: string;
    open_rate: string; click_rate: string; reply_rate: string;
  };
  recentActivity: Array<{ event_type: string; occurred_at: string; to_email: string; subject: string }>;
}

export interface TimelineDataPoint {
  date: string;
  sent: string;
  opened: string;
  clicked: string;
  replied: string;
  bounced: string;
}

export interface ToneBreakdownItem {
  tone: string;
  count: string;
}

export interface SpamCheckResult {
  score: number;
  maxScore: number;
  issues: string[];
  pass: boolean;
}
