import { query } from '../config/database';

interface ThrottleCheck {
  allowed: boolean;
  reason?: string;
  retryAfterMs?: number;
}

/**
 * Check whether a sequence can send right now based on hourly/daily caps.
 * Atomically reserves the slot if allowed.
 */
export async function reserveSendSlot(
  workspaceId: string,
  sequenceId: string,
  hourlyLimit: number,
  dailyLimit: number
): Promise<ThrottleCheck> {
  const now = new Date();
  const bucketHour = new Date(now);
  bucketHour.setMinutes(0, 0, 0);
  const bucketDay = new Date(now);
  bucketDay.setHours(0, 0, 0, 0);

  // Sum sends in current hour
  const hourly = await query<{ total: string }>(
    `SELECT COALESCE(SUM(sent_count), 0)::text AS total
     FROM send_throttle
     WHERE workspace_id = $1 AND sequence_id = $2 AND bucket_hour = $3`,
    [workspaceId, sequenceId, bucketHour]
  );
  const hourlySent = parseInt(hourly.rows[0].total);

  if (hourlySent >= hourlyLimit) {
    const nextHour = new Date(bucketHour);
    nextHour.setHours(nextHour.getHours() + 1);
    return {
      allowed: false,
      reason: `Hourly limit reached (${hourlySent}/${hourlyLimit})`,
      retryAfterMs: nextHour.getTime() - now.getTime(),
    };
  }

  // Sum sends in current day
  const daily = await query<{ total: string }>(
    `SELECT COALESCE(SUM(sent_count), 0)::text AS total
     FROM send_throttle
     WHERE workspace_id = $1 AND sequence_id = $2 AND bucket_hour >= $3`,
    [workspaceId, sequenceId, bucketDay]
  );
  const dailySent = parseInt(daily.rows[0].total);

  if (dailySent >= dailyLimit) {
    const nextDay = new Date(bucketDay);
    nextDay.setDate(nextDay.getDate() + 1);
    return {
      allowed: false,
      reason: `Daily limit reached (${dailySent}/${dailyLimit})`,
      retryAfterMs: nextDay.getTime() - now.getTime(),
    };
  }

  // Reserve slot atomically
  await query(
    `INSERT INTO send_throttle (workspace_id, sequence_id, bucket_hour, sent_count)
     VALUES ($1, $2, $3, 1)
     ON CONFLICT (workspace_id, sequence_id, bucket_hour)
     DO UPDATE SET sent_count = send_throttle.sent_count + 1`,
    [workspaceId, sequenceId, bucketHour]
  );

  return { allowed: true };
}

/**
 * Cleanup old throttle buckets (older than 7 days) — run from a cron or maintenance worker.
 */
export async function cleanupOldThrottleBuckets(): Promise<number> {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 7);
  const result = await query(
    'DELETE FROM send_throttle WHERE bucket_hour < $1',
    [cutoff]
  );
  return result.rowCount || 0;
}
