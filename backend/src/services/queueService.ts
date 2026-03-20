import { Queue, QueueEvents } from 'bullmq';
import { createRedisConnection } from '../config/redis';

// Queues
export const emailSendQueue = new Queue('email-send', {
  connection: createRedisConnection(),
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 5000 },
    removeOnComplete: { age: 86400, count: 10000 },
    removeOnFail: { age: 604800, count: 5000 },
  },
});

export const sequenceQueue = new Queue('sequence-processor', {
  connection: createRedisConnection(),
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 10000 },
    removeOnComplete: { age: 86400, count: 10000 },
    removeOnFail: { age: 604800, count: 5000 },
  },
});

export const campaignQueue = new Queue('campaign-sender', {
  connection: createRedisConnection(),
  defaultJobOptions: {
    attempts: 2,
    backoff: { type: 'exponential', delay: 10000 },
    removeOnComplete: { age: 86400, count: 5000 },
    removeOnFail: { age: 604800, count: 2000 },
  },
});

export const replyProcessQueue = new Queue('reply-processor', {
  connection: createRedisConnection(),
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 5000 },
    removeOnComplete: { age: 86400, count: 5000 },
    removeOnFail: { age: 604800, count: 2000 },
  },
});

// Job scheduling helpers
export interface EmailSendJobData {
  emailLogId: string;
  workspaceId: string;
  contactId: string;
  to: string;
  from: string;
  fromName?: string;
  subject: string;
  htmlBody: string;
  textBody?: string;
  configurationSet?: string;
}

export interface SequenceJobData {
  enrollmentId: string;
  sequenceId: string;
  contactId: string;
  workspaceId: string;
  stepId: string;
}

export interface CampaignJobData {
  campaignId: string;
  workspaceId: string;
}

export interface ReplyProcessJobData {
  replyMessageId: string;
  workspaceId: string;
}

export async function scheduleEmailSend(data: EmailSendJobData, delayMs?: number) {
  return emailSendQueue.add('send', data, {
    ...(delayMs ? { delay: delayMs } : {}),
    jobId: `email-${data.emailLogId}`,
  });
}

export async function scheduleSequenceStep(data: SequenceJobData, delayMs: number) {
  return sequenceQueue.add('process-step', data, {
    delay: delayMs,
    jobId: `seq-${data.enrollmentId}-${data.stepId}`,
  });
}

export async function scheduleCampaignSend(data: CampaignJobData) {
  return campaignQueue.add('send-campaign', data, {
    jobId: `campaign-${data.campaignId}`,
  });
}

export async function scheduleReplyProcess(data: ReplyProcessJobData) {
  return replyProcessQueue.add('process-reply', data, {
    jobId: `reply-${data.replyMessageId}`,
  });
}

export async function cancelEnrollmentJobs(enrollmentId: string): Promise<void> {
  const delayed = await sequenceQueue.getDelayed();
  for (const job of delayed) {
    if (job.data?.enrollmentId === enrollmentId) {
      await job.remove();
    }
  }
  const waiting = await sequenceQueue.getWaiting();
  for (const job of waiting) {
    if (job.data?.enrollmentId === enrollmentId) {
      await job.remove();
    }
  }
}
