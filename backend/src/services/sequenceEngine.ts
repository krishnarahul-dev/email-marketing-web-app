import { query, transaction } from '../config/database';
import { scheduleSequenceStep, cancelEnrollmentJobs, scheduleEmailSend } from './queueService';
import { reserveSendSlot } from './throttleService';
import { pickVariant, recordVariantEvent, checkAndDeclareWinner } from './abTestService';
import { buildPersonalizationData, personalizeContent, personalizeSubject } from '../utils/personalization';
import { injectUnsubscribeLink } from '../utils/unsubscribe';
import { prepareEmailForSending } from '../utils/tracking';
import { computeNextSendAt } from '../utils/businessTime';
import { expandSpintax } from '../utils/spintax';
import { expandSnippets } from '../utils/snippets';
import { v4 as uuidv4 } from 'uuid';

interface SequenceRow {
  id: string;
  workspace_id: string;
  status: string;
  send_window_start: string;
  send_window_end: string;
  send_timezone: string;
  skip_weekends: boolean;
  daily_send_limit: number;
  hourly_send_limit: number;
  auto_pause_on_reply: boolean;
  auto_pause_on_meeting: boolean;
}

interface StepRow {
  id: string;
  sequence_id: string;
  step_order: number;
  step_type: string;
  step_name: string | null;
  delay_days: number;
  delay_hours: number;
  delay_minutes: number;
  delay_business_days: number;
  template_id: string | null;
  subject_override: string | null;
  condition_type: string | null;
  condition_value: string | null;
  parent_step_id: string | null;
  branch_label: string | null;
  task_type: string | null;
  task_instructions: string | null;
  task_priority: string;
  ab_test_enabled: boolean;
  ab_winner_variant_id: string | null;
  use_spintax: boolean;
  is_active: boolean;
}

interface EnrollmentRow {
  id: string;
  sequence_id: string;
  contact_id: string;
  workspace_id: string;
  current_step_id: string | null;
  status: string;
  reply_tone: string | null;
  next_send_at: string | null;
}

// ─── ACTIVITY LOGGING ─────────────────────────────────
async function logActivity(args: {
  workspaceId: string;
  userId?: string;
  contactId?: string;
  sequenceId?: string;
  enrollmentId?: string;
  action: string;
  description?: string;
  metadata?: any;
}): Promise<void> {
  try {
    await query(
      `INSERT INTO activity_log (workspace_id, user_id, contact_id, sequence_id, enrollment_id, action, description, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        args.workspaceId, args.userId || null, args.contactId || null,
        args.sequenceId || null, args.enrollmentId || null,
        args.action, args.description || null, JSON.stringify(args.metadata || {}),
      ]
    );
  } catch (err) {
    console.warn('Activity log failed:', err);
  }
}

// ─── ENROLLMENT ───────────────────────────────────────
export async function enrollContact(
  sequenceId: string,
  contactId: string,
  workspaceId: string,
  source: string = 'manual'
): Promise<EnrollmentRow> {
  const existing = await query(
    'SELECT id FROM sequence_enrollments WHERE sequence_id = $1 AND contact_id = $2',
    [sequenceId, contactId]
  );
  if (existing.rows.length > 0) {
    throw new Error('Contact is already enrolled in this sequence');
  }

  const contact = await query(
    'SELECT * FROM contacts WHERE id = $1 AND workspace_id = $2',
    [contactId, workspaceId]
  );
  if (contact.rows.length === 0) throw new Error('Contact not found');
  if (contact.rows[0].status !== 'active') throw new Error('Contact is not active');

  const suppressed = await query(
    'SELECT id FROM suppression_list WHERE workspace_id = $1 AND email = $2',
    [workspaceId, contact.rows[0].email]
  );
  if (suppressed.rows.length > 0) throw new Error('Contact is on suppression list');

  const sequence = await query<SequenceRow>(
    'SELECT * FROM sequences WHERE id = $1 AND workspace_id = $2',
    [sequenceId, workspaceId]
  );
  if (sequence.rows.length === 0) throw new Error('Sequence not found');

  const firstStep = await query<StepRow>(
    `SELECT * FROM sequence_steps WHERE sequence_id = $1 AND parent_step_id IS NULL
     ORDER BY step_order ASC LIMIT 1`,
    [sequenceId]
  );
  if (firstStep.rows.length === 0) throw new Error('Sequence has no steps');

  const step = firstStep.rows[0];
  const seq = sequence.rows[0];
  const nextSendAt = computeNextSendAt(new Date(), step, {
    start: seq.send_window_start,
    end: seq.send_window_end,
    timezone: seq.send_timezone,
    skipWeekends: seq.skip_weekends,
  });

  const enrollment = await query<EnrollmentRow>(
    `INSERT INTO sequence_enrollments
       (sequence_id, contact_id, workspace_id, current_step_id, status, next_send_at, enrollment_source, last_activity_at)
     VALUES ($1, $2, $3, $4, 'active', $5, $6, NOW()) RETURNING *`,
    [sequenceId, contactId, workspaceId, step.id, nextSendAt, source]
  );

  // Increment sequence stats
  await query('UPDATE sequences SET total_enrolled = total_enrolled + 1 WHERE id = $1', [sequenceId]);

  await logActivity({
    workspaceId, contactId, sequenceId,
    enrollmentId: enrollment.rows[0].id,
    action: 'enrolled',
    description: `Contact enrolled in sequence`,
    metadata: { source, first_step_at: nextSendAt.toISOString() },
  });

  const delayMs = Math.max(nextSendAt.getTime() - Date.now(), 1000);
  await scheduleSequenceStep(
    {
      enrollmentId: enrollment.rows[0].id,
      sequenceId, contactId, workspaceId, stepId: step.id,
    },
    delayMs
  );

  return enrollment.rows[0];
}

// ─── STEP PROCESSOR ───────────────────────────────────
export async function processSequenceStep(enrollmentId: string, stepId: string): Promise<void> {
  const enrollResult = await query<EnrollmentRow>(
    'SELECT * FROM sequence_enrollments WHERE id = $1',
    [enrollmentId]
  );
  if (enrollResult.rows.length === 0) return;
  const enrollment = enrollResult.rows[0];
  if (enrollment.status !== 'active') return;

  const stepResult = await query<StepRow>('SELECT * FROM sequence_steps WHERE id = $1', [stepId]);
  if (stepResult.rows.length === 0) return;
  const step = stepResult.rows[0];

  const seqResult = await query<SequenceRow>('SELECT * FROM sequences WHERE id = $1', [enrollment.sequence_id]);
  if (seqResult.rows.length === 0) return;
  const sequence = seqResult.rows[0];

  // Don't run if sequence is paused or archived
  if (sequence.status !== 'active') {
    console.log(`Skipping step for enrollment ${enrollmentId}: sequence status = ${sequence.status}`);
    return;
  }

  switch (step.step_type) {
    case 'email':
      await executeEmailStep(enrollment, step, sequence);
      break;
    case 'delay':
      await advanceToNextStep(enrollment, step, sequence);
      break;
    case 'condition':
      await evaluateConditionStep(enrollment, step, sequence);
      break;
    case 'call':
    case 'linkedin':
    case 'task':
      await createTaskFromStep(enrollment, step, sequence);
      break;
    default:
      console.warn(`Unknown step type: ${step.step_type}`);
      await advanceToNextStep(enrollment, step, sequence);
  }
}

// ─── EMAIL STEP ───────────────────────────────────────
async function executeEmailStep(
  enrollment: EnrollmentRow,
  step: StepRow,
  sequence: SequenceRow
): Promise<void> {
  // Check throttle
  const throttleCheck = await reserveSendSlot(
    enrollment.workspace_id,
    enrollment.sequence_id,
    sequence.hourly_send_limit,
    sequence.daily_send_limit
  );
  if (!throttleCheck.allowed) {
    // Reschedule based on throttle retry hint
    const retryDelay = throttleCheck.retryAfterMs || 60 * 60 * 1000;
    console.log(`Throttled — rescheduling step in ${Math.round(retryDelay / 60000)} min: ${throttleCheck.reason}`);
    await scheduleSequenceStep(
      {
        enrollmentId: enrollment.id,
        sequenceId: enrollment.sequence_id,
        contactId: enrollment.contact_id,
        workspaceId: enrollment.workspace_id,
        stepId: step.id,
      },
      retryDelay
    );
    return;
  }

  const contact = await query('SELECT * FROM contacts WHERE id = $1', [enrollment.contact_id]);
  if (contact.rows.length === 0) return;
  const c = contact.rows[0];

  if (c.status !== 'active') {
    await updateEnrollmentStatus(enrollment.id, 'cancelled', 'contact_inactive');
    return;
  }

  // Double-check suppression
  const suppressed = await query(
    'SELECT id FROM suppression_list WHERE workspace_id = $1 AND email = $2',
    [enrollment.workspace_id, c.email]
  );
  if (suppressed.rows.length > 0) {
    await updateEnrollmentStatus(enrollment.id, 'cancelled', 'suppressed');
    return;
  }

  // Resolve template & subject (with A/B testing)
  let templateId = step.template_id;
  let subject = step.subject_override;
  let variantId: string | null = null;

  if (step.ab_test_enabled) {
    const variant = await pickVariant(step.id);
    if (variant) {
      variantId = variant.id;
      if (variant.template_id) templateId = variant.template_id;
      if (variant.subject) subject = variant.subject;
    }
  }

  if (!templateId) {
    console.warn(`Step ${step.id} has no template — advancing`);
    await advanceToNextStep(enrollment, step, sequence);
    return;
  }

  const tplResult = await query('SELECT * FROM templates WHERE id = $1', [templateId]);
  if (tplResult.rows.length === 0) {
    console.warn(`Template ${templateId} not found — advancing`);
    await advanceToNextStep(enrollment, step, sequence);
    return;
  }
  const template = tplResult.rows[0];

  const wsResult = await query('SELECT * FROM workspaces WHERE id = $1', [enrollment.workspace_id]);
  if (wsResult.rows.length === 0) return;
  const workspace = wsResult.rows[0];

  // Build personalization data and process content pipeline:
  // 1. snippets → 2. personalization tokens → 3. spintax → 4. tracking/unsubscribe
  const pData = buildPersonalizationData(c);

  let finalSubject = subject || template.subject || '';
  let finalHtml = template.html_content || '';

  finalSubject = personalizeSubject(finalSubject, pData);
  finalHtml = await expandSnippets(finalHtml, enrollment.workspace_id);
  finalHtml = personalizeContent(finalHtml, pData);

  if (step.use_spintax) {
    finalSubject = expandSpintax(finalSubject);
    finalHtml = expandSpintax(finalHtml);
  }

  // Create email log
  const emailLogId = uuidv4();
  await query(
    `INSERT INTO email_logs (id, workspace_id, contact_id, sequence_id, enrollment_id, step_id,
       from_email, to_email, subject, html_content, status, metadata)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'queued',$11)`,
    [
      emailLogId, enrollment.workspace_id, enrollment.contact_id, enrollment.sequence_id,
      enrollment.id, step.id, workspace.ses_from_email || workspace.ses_from_email || 'noreply@example.com',
      c.email, finalSubject, finalHtml,
      JSON.stringify({ ab_variant_id: variantId }),
    ]
  );

  finalHtml = injectUnsubscribeLink(finalHtml, c.id, enrollment.workspace_id, emailLogId);
  finalHtml = prepareEmailForSending(finalHtml, emailLogId, c.id, enrollment.workspace_id);

  await query(
    'UPDATE email_logs SET html_content = $1 WHERE id = $2',
    [finalHtml, emailLogId]
  );

  // Update enrollment
  await query(
    'UPDATE sequence_enrollments SET current_step_id = $1, last_activity_at = NOW(), updated_at = NOW() WHERE id = $2',
    [step.id, enrollment.id]
  );

  // Record variant send
  if (variantId) {
    await recordVariantEvent(variantId, 'sent');
  }

  // Queue the email
  await scheduleEmailSend({
    emailLogId,
    workspaceId: enrollment.workspace_id,
    contactId: c.id,
    to: c.email,
    from: workspace.ses_from_email,
    fromName: workspace.ses_from_name,
    subject: finalSubject,
    htmlBody: finalHtml,
    configurationSet: workspace.ses_config_set || undefined,
  });

  await logActivity({
    workspaceId: enrollment.workspace_id,
    contactId: c.id,
    sequenceId: enrollment.sequence_id,
    enrollmentId: enrollment.id,
    action: 'step_executed',
    description: `Sent email: ${finalSubject}`,
    metadata: { step_id: step.id, step_name: step.step_name, ab_variant_id: variantId },
  });

  // Schedule next step
  await advanceToNextStep(enrollment, step, sequence);

  // Async winner check
  if (step.ab_test_enabled) {
    checkAndDeclareWinner(step.id).catch((err) => console.warn('AB winner check failed:', err));
  }
}

// ─── TASK STEP (call, linkedin, custom) ──────────────
async function createTaskFromStep(
  enrollment: EnrollmentRow,
  step: StepRow,
  sequence: SequenceRow
): Promise<void> {
  const contact = await query('SELECT * FROM contacts WHERE id = $1', [enrollment.contact_id]);
  if (contact.rows.length === 0) return;
  const c = contact.rows[0];

  // Compute due time using the same business-hours logic
  const dueAt = new Date();

  // Determine task title
  const taskTypeMap: Record<string, string> = {
    call: 'Call contact',
    linkedin: 'LinkedIn action',
    task: 'Task',
  };
  const taskTypeLabel = step.step_type === 'linkedin' ? (step.task_type || 'linkedin_view') : step.step_type;
  const taskTitle = step.step_name || `${taskTypeMap[step.step_type] || 'Task'} for ${c.first_name || c.email}`;

  // Determine assignee — sequence owner or fall back to anyone in the workspace
  const ownerResult = await query(
    'SELECT owner_id FROM sequences WHERE id = $1',
    [enrollment.sequence_id]
  );
  let assignedTo = ownerResult.rows[0]?.owner_id || null;
  if (!assignedTo) {
    const anyUser = await query(
      "SELECT id FROM users WHERE workspace_id = $1 AND is_active = TRUE ORDER BY created_at ASC LIMIT 1",
      [enrollment.workspace_id]
    );
    assignedTo = anyUser.rows[0]?.id || null;
  }

  await query(
    `INSERT INTO tasks (workspace_id, enrollment_id, sequence_id, step_id, contact_id, assigned_to,
       task_type, title, instructions, priority, due_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
    [
      enrollment.workspace_id, enrollment.id, enrollment.sequence_id, step.id,
      enrollment.contact_id, assignedTo,
      taskTypeLabel, taskTitle, step.task_instructions, step.task_priority || 'normal', dueAt,
    ]
  );

  await logActivity({
    workspaceId: enrollment.workspace_id,
    contactId: c.id,
    sequenceId: enrollment.sequence_id,
    enrollmentId: enrollment.id,
    action: 'task_created',
    description: `Created task: ${taskTitle}`,
    metadata: { task_type: taskTypeLabel, assigned_to: assignedTo },
  });

  // Update enrollment current step
  await query(
    'UPDATE sequence_enrollments SET current_step_id = $1, last_activity_at = NOW() WHERE id = $2',
    [step.id, enrollment.id]
  );

  // Advance to next step (task lives independently in the inbox)
  await advanceToNextStep(enrollment, step, sequence);
}

// ─── ADVANCE / BRANCH ────────────────────────────────
async function advanceToNextStep(
  enrollment: EnrollmentRow,
  currentStep: StepRow,
  sequence: SequenceRow
): Promise<void> {
  const nextStepResult = await query<StepRow>(
    `SELECT * FROM sequence_steps
     WHERE sequence_id = $1 AND step_order > $2 AND parent_step_id IS NULL AND is_active = TRUE
     ORDER BY step_order ASC LIMIT 1`,
    [enrollment.sequence_id, currentStep.step_order]
  );

  if (nextStepResult.rows.length === 0) {
    await updateEnrollmentStatus(enrollment.id, 'completed');
    await query('UPDATE sequences SET total_completed = total_completed + 1 WHERE id = $1', [enrollment.sequence_id]);
    await logActivity({
      workspaceId: enrollment.workspace_id,
      contactId: enrollment.contact_id,
      sequenceId: enrollment.sequence_id,
      enrollmentId: enrollment.id,
      action: 'completed',
      description: 'Sequence completed',
    });
    return;
  }

  const nextStep = nextStepResult.rows[0];
  const nextSendAt = computeNextSendAt(new Date(), nextStep, {
    start: sequence.send_window_start,
    end: sequence.send_window_end,
    timezone: sequence.send_timezone,
    skipWeekends: sequence.skip_weekends,
  });

  await query(
    'UPDATE sequence_enrollments SET next_send_at = $1, updated_at = NOW() WHERE id = $2',
    [nextSendAt, enrollment.id]
  );

  const delayMs = Math.max(nextSendAt.getTime() - Date.now(), 1000);
  await scheduleSequenceStep(
    {
      enrollmentId: enrollment.id,
      sequenceId: enrollment.sequence_id,
      contactId: enrollment.contact_id,
      workspaceId: enrollment.workspace_id,
      stepId: nextStep.id,
    },
    delayMs
  );
}

async function evaluateConditionStep(
  enrollment: EnrollmentRow,
  step: StepRow,
  sequence: SequenceRow
): Promise<void> {
  if (step.condition_type === 'reply_tone' && enrollment.reply_tone) {
    const branch = await query<StepRow>(
      `SELECT * FROM sequence_steps
       WHERE parent_step_id = $1 AND condition_value = $2 AND is_active = TRUE
       ORDER BY step_order ASC LIMIT 1`,
      [step.id, enrollment.reply_tone]
    );
    if (branch.rows.length > 0) {
      await processSequenceStep(enrollment.id, branch.rows[0].id);
      return;
    }
    const defaultBranch = await query<StepRow>(
      `SELECT * FROM sequence_steps
       WHERE parent_step_id = $1 AND branch_label = 'default' AND is_active = TRUE
       ORDER BY step_order ASC LIMIT 1`,
      [step.id]
    );
    if (defaultBranch.rows.length > 0) {
      await processSequenceStep(enrollment.id, defaultBranch.rows[0].id);
      return;
    }
  }
  await advanceToNextStep(enrollment, step, sequence);
}

// ─── REPLY HANDLING ──────────────────────────────────
export async function handleReplyForEnrollment(enrollmentId: string, tone: string): Promise<void> {
  await cancelEnrollmentJobs(enrollmentId);

  const enrollment = await query<EnrollmentRow>(
    'SELECT * FROM sequence_enrollments WHERE id = $1',
    [enrollmentId]
  );
  if (enrollment.rows.length === 0) return;
  const e = enrollment.rows[0];

  const seqResult = await query<SequenceRow>('SELECT * FROM sequences WHERE id = $1', [e.sequence_id]);
  if (seqResult.rows.length === 0) return;
  const sequence = seqResult.rows[0];

  await query(
    `UPDATE sequence_enrollments
     SET status = 'replied', reply_tone = $1, last_activity_at = NOW(), updated_at = NOW()
     WHERE id = $2`,
    [tone, enrollmentId]
  );
  await query('UPDATE sequences SET total_replied = total_replied + 1 WHERE id = $1', [e.sequence_id]);

  await logActivity({
    workspaceId: e.workspace_id,
    contactId: e.contact_id,
    sequenceId: e.sequence_id,
    enrollmentId: e.id,
    action: 'reply_received',
    description: `Reply detected — tone: ${tone}`,
    metadata: { tone },
  });

  // Auto-pause behavior
  if (sequence.auto_pause_on_reply) {
    // Check if there's a condition step for branching
    const conditionStep = await query<StepRow>(
      `SELECT * FROM sequence_steps
       WHERE sequence_id = $1 AND step_type = 'condition' AND condition_type = 'reply_tone' AND is_active = TRUE
       ORDER BY step_order ASC LIMIT 1`,
      [e.sequence_id]
    );

    if (conditionStep.rows.length > 0) {
      // Re-activate for branch processing
      await query(`UPDATE sequence_enrollments SET status = 'active' WHERE id = $1`, [enrollmentId]);
      await evaluateConditionStep(e, conditionStep.rows[0], sequence);
    }
    // Otherwise stays paused/replied — agent picks it up manually
  }
}

// ─── MEETING BOOKED ──────────────────────────────────
export async function handleMeetingBooked(contactId: string, workspaceId: string): Promise<void> {
  const enrollments = await query<EnrollmentRow>(
    `SELECT se.*, s.auto_pause_on_meeting
     FROM sequence_enrollments se
     JOIN sequences s ON s.id = se.sequence_id
     WHERE se.contact_id = $1 AND se.workspace_id = $2 AND se.status = 'active'`,
    [contactId, workspaceId]
  );

  for (const e of enrollments.rows) {
    if ((e as any).auto_pause_on_meeting) {
      await cancelEnrollmentJobs(e.id);
      await query(
        `UPDATE sequence_enrollments
         SET status = 'paused', pause_reason = 'meeting_booked', paused_at = NOW(), meeting_booked_at = NOW()
         WHERE id = $1`,
        [e.id]
      );
      await query('UPDATE sequences SET total_meetings = total_meetings + 1 WHERE id = $1', [e.sequence_id]);
      await logActivity({
        workspaceId: e.workspace_id,
        contactId: e.contact_id,
        sequenceId: e.sequence_id,
        enrollmentId: e.id,
        action: 'meeting_booked',
        description: 'Sequence paused — meeting booked',
      });
    }
  }
}

// ─── PAUSE / RESUME / CANCEL ─────────────────────────
export async function pauseEnrollment(enrollmentId: string, reason: string = 'manual'): Promise<void> {
  await cancelEnrollmentJobs(enrollmentId);
  await query(
    `UPDATE sequence_enrollments SET status = 'paused', pause_reason = $1, paused_at = NOW() WHERE id = $2`,
    [reason, enrollmentId]
  );
}

export async function resumeEnrollment(enrollmentId: string): Promise<void> {
  const enrollment = await query<EnrollmentRow>(
    "SELECT * FROM sequence_enrollments WHERE id = $1 AND status = 'paused'",
    [enrollmentId]
  );
  if (enrollment.rows.length === 0) throw new Error('Enrollment not found or not paused');
  const e = enrollment.rows[0];
  if (!e.current_step_id) throw new Error('No current step to resume from');

  await query(
    `UPDATE sequence_enrollments SET status = 'active', pause_reason = NULL, paused_at = NULL WHERE id = $1`,
    [enrollmentId]
  );
  await scheduleSequenceStep(
    {
      enrollmentId: e.id,
      sequenceId: e.sequence_id,
      contactId: e.contact_id,
      workspaceId: e.workspace_id,
      stepId: e.current_step_id,
    },
    1000
  );
}

async function updateEnrollmentStatus(enrollmentId: string, status: string, reason?: string): Promise<void> {
  await query(
    `UPDATE sequence_enrollments
     SET status = $1, completed_at = $2, pause_reason = $3, updated_at = NOW() WHERE id = $4`,
    [status, status === 'completed' ? new Date() : null, reason || null, enrollmentId]
  );
}

// ─── BULK ENROLLMENT ─────────────────────────────────
export async function bulkEnroll(
  sequenceId: string,
  contactIds: string[],
  workspaceId: string,
  source: string = 'manual'
): Promise<{ enrolled: number; skipped: number; errors: string[] }> {
  let enrolled = 0;
  let skipped = 0;
  const errors: string[] = [];

  for (const contactId of contactIds) {
    try {
      await enrollContact(sequenceId, contactId, workspaceId, source);
      enrolled++;
    } catch (error: any) {
      const msg = error.message || '';
      if (msg.includes('already enrolled') || msg.includes('suppression') || msg.includes('not active')) {
        skipped++;
      } else {
        errors.push(`${contactId}: ${msg}`);
      }
    }
  }

  return { enrolled, skipped, errors };
}
