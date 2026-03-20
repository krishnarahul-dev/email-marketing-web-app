import { query, transaction } from '../config/database';
import { scheduleSequenceStep, cancelEnrollmentJobs, scheduleEmailSend } from './queueService';
import { buildPersonalizationData, personalizeContent, personalizeSubject } from '../utils/personalization';
import { injectUnsubscribeLink } from '../utils/unsubscribe';
import { prepareEmailForSending } from '../utils/tracking';
import { SequenceStep, SequenceEnrollment, Contact, Template } from '../types';
import { v4 as uuidv4 } from 'uuid';

export async function enrollContact(
  sequenceId: string,
  contactId: string,
  workspaceId: string
): Promise<SequenceEnrollment> {
  // Check if already enrolled
  const existing = await query(
    'SELECT id FROM sequence_enrollments WHERE sequence_id = $1 AND contact_id = $2',
    [sequenceId, contactId]
  );
  if (existing.rows.length > 0) {
    throw new Error('Contact is already enrolled in this sequence');
  }

  // Check suppression list
  const contact = await query<Contact>('SELECT * FROM contacts WHERE id = $1 AND workspace_id = $2', [
    contactId,
    workspaceId,
  ]);
  if (contact.rows.length === 0) throw new Error('Contact not found');
  if (contact.rows[0].status !== 'active') throw new Error('Contact is not active');

  const suppressed = await query(
    'SELECT id FROM suppression_list WHERE workspace_id = $1 AND email = $2',
    [workspaceId, contact.rows[0].email]
  );
  if (suppressed.rows.length > 0) throw new Error('Contact is on suppression list');

  // Get first step
  const firstStep = await query<SequenceStep>(
    `SELECT * FROM sequence_steps WHERE sequence_id = $1 AND parent_step_id IS NULL
     ORDER BY step_order ASC LIMIT 1`,
    [sequenceId]
  );
  if (firstStep.rows.length === 0) throw new Error('Sequence has no steps');

  const step = firstStep.rows[0];
  const delayMs = (step.delay_days * 86400000) + (step.delay_hours * 3600000);
  const nextSendAt = new Date(Date.now() + delayMs);

  const enrollment = await query<SequenceEnrollment>(
    `INSERT INTO sequence_enrollments (sequence_id, contact_id, workspace_id, current_step_id, status, next_send_at)
     VALUES ($1, $2, $3, $4, 'active', $5) RETURNING *`,
    [sequenceId, contactId, workspaceId, step.id, nextSendAt]
  );

  // Schedule first step
  await scheduleSequenceStep(
    {
      enrollmentId: enrollment.rows[0].id,
      sequenceId,
      contactId,
      workspaceId,
      stepId: step.id,
    },
    Math.max(delayMs, 1000) // minimum 1s delay
  );

  return enrollment.rows[0];
}

export async function processSequenceStep(
  enrollmentId: string,
  stepId: string
): Promise<void> {
  const enrollResult = await query<SequenceEnrollment>(
    'SELECT * FROM sequence_enrollments WHERE id = $1',
    [enrollmentId]
  );
  if (enrollResult.rows.length === 0) return;
  const enrollment = enrollResult.rows[0];

  // Skip if no longer active
  if (enrollment.status !== 'active') return;

  const stepResult = await query<SequenceStep>('SELECT * FROM sequence_steps WHERE id = $1', [stepId]);
  if (stepResult.rows.length === 0) return;
  const step = stepResult.rows[0];

  if (step.step_type === 'email') {
    await executeEmailStep(enrollment, step);
  } else if (step.step_type === 'delay') {
    // Delay steps just schedule the next step
    await advanceToNextStep(enrollment, step);
  } else if (step.step_type === 'condition') {
    await evaluateConditionStep(enrollment, step);
  }
}

async function executeEmailStep(enrollment: SequenceEnrollment, step: SequenceStep): Promise<void> {
  const contact = await query<Contact>('SELECT * FROM contacts WHERE id = $1', [enrollment.contact_id]);
  if (contact.rows.length === 0) return;
  const c = contact.rows[0];

  if (c.status !== 'active') {
    await updateEnrollmentStatus(enrollment.id, 'cancelled');
    return;
  }

  // Get template
  const templateResult = await query<Template>('SELECT * FROM templates WHERE id = $1', [step.template_id]);
  if (templateResult.rows.length === 0) return;
  const template = templateResult.rows[0];

  // Get workspace
  const wsResult = await query('SELECT * FROM workspaces WHERE id = $1', [enrollment.workspace_id]);
  if (wsResult.rows.length === 0) return;
  const workspace = wsResult.rows[0];

  // Personalize
  const pData = buildPersonalizationData(c);
  const subject = personalizeSubject(step.subject_override || template.subject || '', pData);
  let html = personalizeContent(template.html_content || '', pData);

  // Create email log
  const emailLogId = uuidv4();
  await query(
    `INSERT INTO email_logs (id, workspace_id, contact_id, sequence_id, enrollment_id, step_id,
     from_email, to_email, subject, html_content, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'queued')`,
    [
      emailLogId, enrollment.workspace_id, enrollment.contact_id, enrollment.sequence_id,
      enrollment.id, step.id, workspace.ses_from_email, c.email, subject, html,
    ]
  );

  // Inject tracking + unsubscribe
  html = injectUnsubscribeLink(html, c.id, enrollment.workspace_id, emailLogId);
  html = prepareEmailForSending(html, emailLogId, c.id, enrollment.workspace_id);

  // Queue email
  await scheduleEmailSend({
    emailLogId,
    workspaceId: enrollment.workspace_id,
    contactId: c.id,
    to: c.email,
    from: workspace.ses_from_email,
    fromName: workspace.ses_from_name,
    subject,
    htmlBody: html,
    configurationSet: workspace.ses_config_set || undefined,
  });

  // Update enrollment
  await query(
    'UPDATE sequence_enrollments SET current_step_id = $1, updated_at = NOW() WHERE id = $2',
    [step.id, enrollment.id]
  );

  // Schedule next step
  await advanceToNextStep(enrollment, step);
}

async function advanceToNextStep(enrollment: SequenceEnrollment, currentStep: SequenceStep): Promise<void> {
  // Find next step in order
  const nextStepResult = await query<SequenceStep>(
    `SELECT * FROM sequence_steps
     WHERE sequence_id = $1 AND step_order > $2 AND parent_step_id IS NULL AND is_active = TRUE
     ORDER BY step_order ASC LIMIT 1`,
    [enrollment.sequence_id, currentStep.step_order]
  );

  if (nextStepResult.rows.length === 0) {
    // Sequence complete
    await updateEnrollmentStatus(enrollment.id, 'completed');
    return;
  }

  const nextStep = nextStepResult.rows[0];
  const delayMs = (nextStep.delay_days * 86400000) + (nextStep.delay_hours * 3600000);
  const nextSendAt = new Date(Date.now() + delayMs);

  await query(
    'UPDATE sequence_enrollments SET next_send_at = $1, updated_at = NOW() WHERE id = $2',
    [nextSendAt, enrollment.id]
  );

  await scheduleSequenceStep(
    {
      enrollmentId: enrollment.id,
      sequenceId: enrollment.sequence_id,
      contactId: enrollment.contact_id,
      workspaceId: enrollment.workspace_id,
      stepId: nextStep.id,
    },
    Math.max(delayMs, 1000)
  );
}

async function evaluateConditionStep(enrollment: SequenceEnrollment, step: SequenceStep): Promise<void> {
  if (step.condition_type === 'reply_tone' && enrollment.reply_tone) {
    // Find matching branch
    const branch = await query<SequenceStep>(
      `SELECT * FROM sequence_steps
       WHERE parent_step_id = $1 AND condition_value = $2 AND is_active = TRUE
       ORDER BY step_order ASC LIMIT 1`,
      [step.id, enrollment.reply_tone]
    );

    if (branch.rows.length > 0) {
      await executeEmailStep(enrollment, branch.rows[0]);
      return;
    }

    // Try default branch
    const defaultBranch = await query<SequenceStep>(
      `SELECT * FROM sequence_steps
       WHERE parent_step_id = $1 AND branch_label = 'default' AND is_active = TRUE
       ORDER BY step_order ASC LIMIT 1`,
      [step.id]
    );

    if (defaultBranch.rows.length > 0) {
      await executeEmailStep(enrollment, defaultBranch.rows[0]);
      return;
    }
  }

  // No matching branch — advance to next top-level step
  await advanceToNextStep(enrollment, step);
}

export async function handleReplyForEnrollment(
  enrollmentId: string,
  tone: string
): Promise<void> {
  // Cancel pending steps
  await cancelEnrollmentJobs(enrollmentId);

  // Update enrollment
  await query(
    `UPDATE sequence_enrollments SET status = 'replied', reply_tone = $1, updated_at = NOW() WHERE id = $2`,
    [tone, enrollmentId]
  );

  // Check if there's a condition step that handles this tone
  const enrollment = await query<SequenceEnrollment>(
    'SELECT * FROM sequence_enrollments WHERE id = $1',
    [enrollmentId]
  );
  if (enrollment.rows.length === 0) return;

  const conditionStep = await query<SequenceStep>(
    `SELECT * FROM sequence_steps
     WHERE sequence_id = $1 AND step_type = 'condition' AND condition_type = 'reply_tone' AND is_active = TRUE
     ORDER BY step_order ASC LIMIT 1`,
    [enrollment.rows[0].sequence_id]
  );

  if (conditionStep.rows.length > 0) {
    // Re-activate enrollment for branch processing
    await query(
      `UPDATE sequence_enrollments SET status = 'active', updated_at = NOW() WHERE id = $1`,
      [enrollmentId]
    );
    await evaluateConditionStep(enrollment.rows[0], conditionStep.rows[0]);
  }
}

async function updateEnrollmentStatus(enrollmentId: string, status: string): Promise<void> {
  await query(
    `UPDATE sequence_enrollments SET status = $1, completed_at = $2, updated_at = NOW() WHERE id = $3`,
    [status, status === 'completed' ? new Date() : null, enrollmentId]
  );
}

export async function bulkEnroll(
  sequenceId: string,
  contactIds: string[],
  workspaceId: string
): Promise<{ enrolled: number; skipped: number; errors: string[] }> {
  let enrolled = 0;
  let skipped = 0;
  const errors: string[] = [];

  for (const contactId of contactIds) {
    try {
      await enrollContact(sequenceId, contactId, workspaceId);
      enrolled++;
    } catch (error: any) {
      if (error.message.includes('already enrolled') || error.message.includes('suppression')) {
        skipped++;
      } else {
        errors.push(`${contactId}: ${error.message}`);
      }
    }
  }

  return { enrolled, skipped, errors };
}
