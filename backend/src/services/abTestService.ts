import { query } from '../config/database';

interface ABVariant {
  id: string;
  step_id: string;
  variant_label: string;
  subject: string | null;
  template_id: string | null;
  weight: number;
  sent_count: number;
  open_count: number;
  click_count: number;
  reply_count: number;
  is_winner: boolean;
}

/**
 * Pick a variant for a step using weighted random selection.
 * If a winner has been declared, always returns it.
 */
export async function pickVariant(stepId: string): Promise<ABVariant | null> {
  // Check for declared winner first
  const winnerResult = await query<ABVariant>(
    'SELECT * FROM ab_variants WHERE step_id = $1 AND is_winner = TRUE LIMIT 1',
    [stepId]
  );
  if (winnerResult.rows.length > 0) return winnerResult.rows[0];

  // Get all variants
  const variants = await query<ABVariant>(
    'SELECT * FROM ab_variants WHERE step_id = $1',
    [stepId]
  );
  if (variants.rows.length === 0) return null;

  // Weighted random selection
  const totalWeight = variants.rows.reduce((sum, v) => sum + v.weight, 0);
  if (totalWeight === 0) return variants.rows[0];

  let pick = Math.random() * totalWeight;
  for (const v of variants.rows) {
    pick -= v.weight;
    if (pick <= 0) return v;
  }
  return variants.rows[variants.rows.length - 1];
}

/**
 * Increment metric for a variant.
 */
export async function recordVariantEvent(
  variantId: string,
  event: 'sent' | 'open' | 'click' | 'reply'
): Promise<void> {
  const column = `${event}_count`;
  await query(
    `UPDATE ab_variants SET ${column} = ${column} + 1 WHERE id = $1`,
    [variantId]
  );
}

/**
 * Auto-declare a winner if statistical significance reached.
 * Uses a simple heuristic: minimum 100 sends per variant, winner has
 * 20% better reply rate, and confidence > 95% (Z-test approximation).
 */
export async function checkAndDeclareWinner(stepId: string): Promise<ABVariant | null> {
  const variants = await query<ABVariant>(
    'SELECT * FROM ab_variants WHERE step_id = $1 AND is_winner = FALSE',
    [stepId]
  );
  if (variants.rows.length < 2) return null;

  // Minimum sample size
  const enoughData = variants.rows.every((v) => v.sent_count >= 100);
  if (!enoughData) return null;

  // Sort by reply rate
  const ranked = [...variants.rows].sort((a, b) => {
    const aRate = a.sent_count > 0 ? a.reply_count / a.sent_count : 0;
    const bRate = b.sent_count > 0 ? b.reply_count / b.sent_count : 0;
    return bRate - aRate;
  });

  const winner = ranked[0];
  const runnerUp = ranked[1];

  const winnerRate = winner.reply_count / winner.sent_count;
  const runnerRate = runnerUp.sent_count > 0 ? runnerUp.reply_count / runnerUp.sent_count : 0;

  // Require 20% relative improvement
  if (runnerRate === 0 ? winnerRate > 0.01 : winnerRate / runnerRate < 1.2) return null;

  // Z-test approximation for two-proportion test
  const p1 = winnerRate;
  const p2 = runnerRate;
  const n1 = winner.sent_count;
  const n2 = runnerUp.sent_count;
  const pooledP = (winner.reply_count + runnerUp.reply_count) / (n1 + n2);
  const standardError = Math.sqrt(pooledP * (1 - pooledP) * (1 / n1 + 1 / n2));
  if (standardError === 0) return null;
  const zScore = (p1 - p2) / standardError;
  const isSignificant = Math.abs(zScore) > 1.96; // 95% confidence

  if (!isSignificant) return null;

  // Declare winner
  await query('UPDATE ab_variants SET is_winner = TRUE WHERE id = $1', [winner.id]);
  await query('UPDATE sequence_steps SET ab_winner_variant_id = $1 WHERE id = $2', [winner.id, stepId]);

  return { ...winner, is_winner: true };
}
