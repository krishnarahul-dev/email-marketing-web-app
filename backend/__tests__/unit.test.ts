import { personalizeContent, personalizeSubject, extractTokens, buildPersonalizationData } from '../src/utils/personalization';
import { checkSpamScore } from '../src/utils/spamScorer';
import { generateLinkSignature, verifyLinkSignature } from '../src/utils/tracking';

// ─── Personalization Tests ──────────────────────────────────

describe('personalizeContent', () => {
  test('replaces known tokens', () => {
    const result = personalizeContent('Hello {{first_name}} at {{company}}', {
      first_name: 'Alice',
      company: 'Acme',
    });
    expect(result).toBe('Hello Alice at Acme');
  });

  test('leaves unknown tokens intact', () => {
    const result = personalizeContent('Hello {{unknown_field}}', { first_name: 'Bob' });
    expect(result).toBe('Hello {{unknown_field}}');
  });

  test('escapes HTML in values', () => {
    const result = personalizeContent('Name: {{first_name}}', {
      first_name: '<script>alert("xss")</script>',
    });
    expect(result).not.toContain('<script>');
    expect(result).toContain('&lt;script&gt;');
  });

  test('handles empty data', () => {
    const result = personalizeContent('Hi {{first_name}}', {});
    expect(result).toBe('Hi {{first_name}}');
  });
});

describe('personalizeSubject', () => {
  test('replaces tokens and removes missing', () => {
    const result = personalizeSubject('Hi {{first_name}}, re: {{topic}}', {
      first_name: 'Alice',
    });
    expect(result).toBe('Hi Alice, re: ');
  });
});

describe('extractTokens', () => {
  test('extracts unique tokens', () => {
    const tokens = extractTokens('{{first_name}} {{company}} {{first_name}}');
    expect(tokens).toEqual(['first_name', 'company']);
  });

  test('returns empty for no tokens', () => {
    expect(extractTokens('No tokens here')).toEqual([]);
  });
});

describe('buildPersonalizationData', () => {
  test('builds full_name from parts', () => {
    const data = buildPersonalizationData({
      email: 'test@example.com',
      first_name: 'John',
      last_name: 'Doe',
      company: 'Acme',
      title: 'CEO',
    });
    expect(data.full_name).toBe('John Doe');
    expect(data.email).toBe('test@example.com');
  });

  test('handles null fields gracefully', () => {
    const data = buildPersonalizationData({
      email: 'test@example.com',
      first_name: null,
      last_name: null,
    });
    expect(data.first_name).toBe('');
    expect(data.full_name).toBe('');
  });
});

// ─── Spam Scorer Tests ──────────────────────────────────────

describe('checkSpamScore', () => {
  test('clean email passes', () => {
    const html = `
      <html><body>
        <p>Hello, I wanted to reach out about our product.</p>
        <p>Let me know if you have time for a quick call.</p>
        <a href="https://example.com/unsubscribe">Unsubscribe</a>
      </body></html>
    `;
    const result = checkSpamScore(html, 'Quick question about your workflow');
    expect(result.pass).toBe(true);
    expect(result.score).toBeLessThan(3);
  });

  test('detects ALL CAPS subject', () => {
    const result = checkSpamScore('<p>Content</p>', 'FREE MONEY NOW!!!');
    expect(result.issues).toContain('ALL_CAPS_SUBJECT');
  });

  test('detects URL shorteners', () => {
    const result = checkSpamScore('<p>Click <a href="https://bit.ly/abc">here</a></p>');
    expect(result.issues).toContain('URL_SHORTENER');
  });

  test('detects missing unsubscribe', () => {
    const result = checkSpamScore('<p>Just some content with no opt-out link</p>');
    expect(result.issues).toContain('MISSING_UNSUBSCRIBE');
  });

  test('detects excessive exclamation marks', () => {
    const result = checkSpamScore('<p>Amazing!!!! Great!!!! Wow!!!!</p>');
    expect(result.issues).toContain('EXCESSIVE_EXCLAMATION');
  });

  test('detects javascript in email', () => {
    const result = checkSpamScore('<p>Hello</p><script>alert(1)</script>');
    expect(result.issues).toContain('JAVASCRIPT_IN_EMAIL');
    expect(result.pass).toBe(false);
  });

  test('detects spam trigger words', () => {
    const result = checkSpamScore('<p>Act now for free money! No obligation risk free offer!</p>');
    expect(result.issues).toContain('SPAM_TRIGGER_WORDS');
  });

  test('long subject penalty', () => {
    const longSubject = 'This is an extremely long subject line that definitely exceeds sixty characters in total length';
    const result = checkSpamScore('<p>Content</p>', longSubject);
    expect(result.issues).toContain('LONG_SUBJECT');
  });
});

// ─── Tracking Link Signature Tests ──────────────────────────

describe('Link Signatures', () => {
  test('generates consistent signatures', () => {
    const sig1 = generateLinkSignature('log-123', 'https://example.com');
    const sig2 = generateLinkSignature('log-123', 'https://example.com');
    expect(sig1).toBe(sig2);
  });

  test('different inputs produce different signatures', () => {
    const sig1 = generateLinkSignature('log-123', 'https://example.com');
    const sig2 = generateLinkSignature('log-456', 'https://example.com');
    expect(sig1).not.toBe(sig2);
  });

  test('verification passes for valid signatures', () => {
    const sig = generateLinkSignature('log-123', 'https://example.com');
    expect(verifyLinkSignature('log-123', 'https://example.com', sig)).toBe(true);
  });

  test('verification fails for tampered signatures', () => {
    expect(verifyLinkSignature('log-123', 'https://example.com', 'tampered1234abcd')).toBe(false);
  });
});
