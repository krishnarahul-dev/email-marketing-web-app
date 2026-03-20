import Anthropic from '@anthropic-ai/sdk';
import { config } from '../config';
import { ToneResult, ToneCategory } from '../types';

const client = new Anthropic({ apiKey: config.claude.apiKey });

const VALID_TONES: ToneCategory[] = [
  'interested',
  'objection',
  'not_interested',
  'neutral',
  'unsubscribe',
  'out_of_office',
];

const SYSTEM_PROMPT = `You are an email reply classifier for a sales outreach platform.
Analyze the reply and classify it into exactly one category.

Categories:
- interested: The person wants to learn more, schedule a call, asks questions about the product/service
- objection: The person has concerns or pushback but hasn't fully rejected (pricing, timing, features)
- not_interested: Clear rejection, asks to stop contacting, says no
- unsubscribe: Explicitly asks to be removed from the mailing list
- out_of_office: Auto-reply, vacation notice, OOO message
- neutral: Acknowledgment without clear intent, unclear response

Respond with ONLY a valid JSON object in this exact format, no other text:
{"category":"<one_of_the_categories>","confidence":<0.0_to_1.0>,"reasoning":"<brief_explanation>"}`;

export async function detectTone(replyText: string): Promise<ToneResult> {
  if (!replyText || replyText.trim().length === 0) {
    return { category: 'neutral', confidence: 0.5, reasoning: 'Empty reply text' };
  }

  // Quick OOO detection without API call
  const lowerText = replyText.toLowerCase();
  if (
    lowerText.includes('out of office') ||
    lowerText.includes('out of the office') ||
    lowerText.includes('automatic reply') ||
    lowerText.includes('auto-reply') ||
    lowerText.includes('on vacation') ||
    lowerText.includes('currently away')
  ) {
    return { category: 'out_of_office', confidence: 0.95, reasoning: 'Auto-detected OOO keywords' };
  }

  try {
    const response = await client.messages.create({
      model: config.claude.model,
      max_tokens: 200,
      messages: [
        {
          role: 'user',
          content: `Classify this email reply:\n\n---\n${replyText.substring(0, 2000)}\n---`,
        },
      ],
      system: SYSTEM_PROMPT,
    });

    const text = response.content[0].type === 'text' ? response.content[0].text : '';
    const parsed = JSON.parse(text.trim());

    // Validate response
    if (!VALID_TONES.includes(parsed.category)) {
      console.warn('Invalid tone category from Claude:', parsed.category);
      return { category: 'neutral', confidence: 0.3, reasoning: 'Invalid category returned' };
    }

    return {
      category: parsed.category as ToneCategory,
      confidence: Math.max(0, Math.min(1, parseFloat(parsed.confidence) || 0.5)),
      reasoning: String(parsed.reasoning || '').substring(0, 500),
    };
  } catch (error: any) {
    console.error('Tone detection error:', error.message);
    return { category: 'neutral', confidence: 0.0, reasoning: `Detection failed: ${error.message}` };
  }
}
