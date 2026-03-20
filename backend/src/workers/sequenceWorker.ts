import { Worker, Job } from 'bullmq';
import { createRedisConnection } from '../config/redis';
import { processSequenceStep } from '../services/sequenceEngine';
import { SequenceJobData } from '../services/queueService';

export function startSequenceWorker(): Worker {
  const worker = new Worker<SequenceJobData>(
    'sequence-processor',
    async (job: Job<SequenceJobData>) => {
      const { enrollmentId, stepId } = job.data;

      try {
        await processSequenceStep(enrollmentId, stepId);
        return { status: 'processed' };
      } catch (error: any) {
        console.error(`Sequence step failed for enrollment ${enrollmentId}, step ${stepId}:`, error.message);
        throw error;
      }
    },
    {
      connection: createRedisConnection(),
      concurrency: 10,
    }
  );

  worker.on('completed', (job) => {
    console.log(`Sequence job ${job.id} completed`);
  });

  worker.on('failed', (job, err) => {
    console.error(`Sequence job ${job?.id} failed:`, err.message);
  });

  console.log('Sequence worker started');
  return worker;
}
