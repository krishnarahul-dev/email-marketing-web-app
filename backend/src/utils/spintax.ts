/**
 * Spintax — generate variations using {option1|option2|option3} syntax.
 * Supports nesting: {Hi {there|friend}|Hello {{first_name}}}
 *
 * Used to add subtle variation to outbound emails for deliverability.
 */

const SPIN_REGEX = /\{([^{}]+)\}/;

export function expandSpintax(text: string): string {
  let result = text;
  let safety = 100;

  // Iteratively replace innermost {a|b|c} with a random pick.
  while (SPIN_REGEX.test(result) && safety-- > 0) {
    result = result.replace(SPIN_REGEX, (_match, options: string) => {
      // Skip personalization tokens like {{first_name}} — they don't have pipes
      // and would have been consumed if they did.
      if (!options.includes('|')) {
        // Restore as-is — wrap back in braces to prevent re-matching
        return `\u0001${options}\u0002`;
      }
      const choices = options.split('|').map((s) => s.trim());
      return choices[Math.floor(Math.random() * choices.length)];
    });
  }

  // Restore preserved tokens
  return result.replace(/\u0001/g, '{').replace(/\u0002/g, '}');
}

/**
 * Extract all spintax patterns for previewing variations.
 */
export function countVariations(text: string): number {
  const matches = text.match(/\{[^{}|]+(?:\|[^{}|]+)+\}/g);
  if (!matches) return 1;
  return matches.reduce((acc, m) => acc * m.split('|').length, 1);
}
