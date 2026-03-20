import { PersonalizationData } from '../types';

const TOKEN_REGEX = /\{\{(\w+)\}\}/g;

export function personalizeContent(content: string, data: PersonalizationData): string {
  return content.replace(TOKEN_REGEX, (match, key) => {
    const value = data[key];
    if (value !== undefined && value !== null) {
      return escapeHtml(String(value));
    }
    return match; // leave token as-is if no value
  });
}

export function personalizeSubject(subject: string, data: PersonalizationData): string {
  return subject.replace(TOKEN_REGEX, (match, key) => {
    const value = data[key];
    if (value !== undefined && value !== null) {
      return String(value);
    }
    return '';
  });
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}

export function extractTokens(content: string): string[] {
  const tokens: string[] = [];
  let match: RegExpExecArray | null;
  const regex = new RegExp(TOKEN_REGEX);
  while ((match = regex.exec(content)) !== null) {
    if (!tokens.includes(match[1])) {
      tokens.push(match[1]);
    }
  }
  return tokens;
}

export function buildPersonalizationData(contact: {
  email: string;
  first_name?: string | null;
  last_name?: string | null;
  company?: string | null;
  title?: string | null;
  custom_fields?: Record<string, any>;
}): PersonalizationData {
  return {
    email: contact.email,
    first_name: contact.first_name || '',
    last_name: contact.last_name || '',
    company: contact.company || '',
    title: contact.title || '',
    full_name: [contact.first_name, contact.last_name].filter(Boolean).join(' ') || '',
    ...(contact.custom_fields || {}),
  };
}
