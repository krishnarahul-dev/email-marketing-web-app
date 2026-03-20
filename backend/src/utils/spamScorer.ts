interface SpamCheckResult {
  score: number;
  maxScore: number;
  issues: string[];
  pass: boolean;
}

const SPAM_RULES: Array<{ name: string; check: (html: string, subject?: string) => boolean; penalty: number }> = [
  {
    name: 'ALL_CAPS_SUBJECT',
    check: (_html, subject) => !!subject && subject === subject.toUpperCase() && subject.length > 5,
    penalty: 2,
  },
  {
    name: 'EXCESSIVE_EXCLAMATION',
    check: (html) => (html.match(/!/g) || []).length > 3,
    penalty: 1.5,
  },
  {
    name: 'ALL_CAPS_WORDS',
    check: (html) => {
      const text = html.replace(/<[^>]+>/g, '');
      const capsWords = text.match(/\b[A-Z]{4,}\b/g) || [];
      return capsWords.length > 3;
    },
    penalty: 1.5,
  },
  {
    name: 'URL_SHORTENER',
    check: (html) => /bit\.ly|tinyurl|t\.co|goo\.gl|ow\.ly/i.test(html),
    penalty: 3,
  },
  {
    name: 'MISSING_UNSUBSCRIBE',
    check: (html) => !html.toLowerCase().includes('unsubscribe'),
    penalty: 2,
  },
  {
    name: 'SPAM_TRIGGER_WORDS',
    check: (html) => {
      const text = html.replace(/<[^>]+>/g, '').toLowerCase();
      const triggers = ['free money', 'act now', 'limited time', 'click here now', 'buy now', 'no obligation', 'risk free', 'winner', 'congratulations', 'you have been selected'];
      return triggers.some((t) => text.includes(t));
    },
    penalty: 2,
  },
  {
    name: 'HIGH_IMAGE_RATIO',
    check: (html) => {
      const images = (html.match(/<img/gi) || []).length;
      const text = html.replace(/<[^>]+>/g, '').trim();
      const wordCount = text.split(/\s+/).length;
      return images > 0 && wordCount < images * 20;
    },
    penalty: 1.5,
  },
  {
    name: 'NO_TEXT_CONTENT',
    check: (html) => {
      const text = html.replace(/<[^>]+>/g, '').trim();
      return text.length < 50;
    },
    penalty: 2,
  },
  {
    name: 'LONG_SUBJECT',
    check: (_html, subject) => !!subject && subject.length > 60,
    penalty: 1,
  },
  {
    name: 'JAVASCRIPT_IN_EMAIL',
    check: (html) => /<script/i.test(html),
    penalty: 5,
  },
  {
    name: 'FORM_IN_EMAIL',
    check: (html) => /<form/i.test(html),
    penalty: 3,
  },
];

export function checkSpamScore(htmlContent: string, subject?: string): SpamCheckResult {
  const issues: string[] = [];
  let score = 0;

  for (const rule of SPAM_RULES) {
    if (rule.check(htmlContent, subject)) {
      issues.push(rule.name);
      score += rule.penalty;
    }
  }

  return {
    score: Math.round(score * 10) / 10,
    maxScore: 10,
    issues,
    pass: score < 3,
  };
}
