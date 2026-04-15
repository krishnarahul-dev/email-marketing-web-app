import { query, transaction } from '../config/database';

export interface MailboxRow {
  id: string;
  workspace_id: string;
  from_email: string;
  from_name: string | null;
  reply_to_email: string | null;
  signature_html: string | null;
  daily_send_limit: number;
  daily_sent_count: number;
  daily_count_reset_at: string;
  total_sent_count: number;
  last_used_at: string | null;
  status: string;
  is_active: boolean;
  is_default: boolean;
}

/**
 * Pick the next mailbox to send from using round-robin with capacity.
 * Strategy:
 *   1. Filter to active + verified mailboxes in the workspace
 *   2. Reset daily counters for any mailbox whose reset date is in the past
 *   3. Filter to mailboxes that still have capacity (daily_sent_count < daily_send_limit)
 *   4. Return the one with the OLDEST last_used_at (NULLS FIRST = never used wins)
 *   5. Atomically increment its counter
 *
 * If a `preferredMailboxId` is provided, use it directly (no rotation).
 *
 * Returns null if no mailbox has capacity right now.
 */
export async function reserveMailbox(
  workspaceId: string,
  preferredMailboxId?: string | null
): Promise<MailboxRow | null> {
  return transaction(async (client) => {
    // Reset daily counters for any mailbox whose reset date has passed
    await client.query(
      `UPDATE mailboxes SET daily_sent_count = 0, daily_count_reset_at = CURRENT_DATE
       WHERE workspace_id = $1 AND daily_count_reset_at < CURRENT_DATE`,
      [workspaceId]
    );

    // If a specific mailbox is requested, use it (still check capacity)
    if (preferredMailboxId) {
      const result = await client.query<MailboxRow>(
        `SELECT * FROM mailboxes
         WHERE id = $1 AND workspace_id = $2 AND is_active = TRUE AND status = 'verified'
           AND daily_sent_count < daily_send_limit
         FOR UPDATE`,
        [preferredMailboxId, workspaceId]
      );
      if (result.rows.length === 0) return null;
      const mailbox = result.rows[0];
      await client.query(
        `UPDATE mailboxes SET daily_sent_count = daily_sent_count + 1,
           total_sent_count = total_sent_count + 1, last_used_at = NOW()
         WHERE id = $1`,
        [mailbox.id]
      );
      return mailbox;
    }

    // Round-robin: pick the verified mailbox with capacity that was used least recently
    const result = await client.query<MailboxRow>(
      `SELECT * FROM mailboxes
       WHERE workspace_id = $1 AND is_active = TRUE AND status = 'verified'
         AND daily_sent_count < daily_send_limit
       ORDER BY last_used_at ASC NULLS FIRST, id ASC
       LIMIT 1
       FOR UPDATE`,
      [workspaceId]
    );

    if (result.rows.length === 0) return null;

    const mailbox = result.rows[0];
    await client.query(
      `UPDATE mailboxes SET daily_sent_count = daily_sent_count + 1,
         total_sent_count = total_sent_count + 1, last_used_at = NOW()
       WHERE id = $1`,
      [mailbox.id]
    );
    return mailbox;
  });
}

/**
 * Decrement the count for a mailbox if a send fails (so we don't waste capacity).
 * Best-effort — non-blocking failures should still let the queue retry.
 */
export async function releaseMailboxSlot(mailboxId: string): Promise<void> {
  await query(
    `UPDATE mailboxes SET daily_sent_count = GREATEST(0, daily_sent_count - 1),
       total_sent_count = GREATEST(0, total_sent_count - 1)
     WHERE id = $1`,
    [mailboxId]
  );
}

/**
 * Get total sending capacity available right now across all mailboxes.
 */
export async function getWorkspaceCapacity(workspaceId: string): Promise<{
  totalCapacity: number;
  capacityRemaining: number;
  activeMailboxCount: number;
  verifiedMailboxCount: number;
}> {
  const result = await query<{
    total_capacity: string;
    capacity_remaining: string;
    active_count: string;
    verified_count: string;
  }>(
    `SELECT
       COALESCE(SUM(daily_send_limit) FILTER (WHERE status = 'verified' AND is_active = TRUE), 0)::text AS total_capacity,
       COALESCE(SUM(GREATEST(0, daily_send_limit - daily_sent_count)) FILTER (WHERE status = 'verified' AND is_active = TRUE), 0)::text AS capacity_remaining,
       COUNT(*) FILTER (WHERE is_active = TRUE)::text AS active_count,
       COUNT(*) FILTER (WHERE is_active = TRUE AND status = 'verified')::text AS verified_count
     FROM mailboxes WHERE workspace_id = $1`,
    [workspaceId]
  );
  const row = result.rows[0];
  return {
    totalCapacity: parseInt(row.total_capacity),
    capacityRemaining: parseInt(row.capacity_remaining),
    activeMailboxCount: parseInt(row.active_count),
    verifiedMailboxCount: parseInt(row.verified_count),
  };
}
