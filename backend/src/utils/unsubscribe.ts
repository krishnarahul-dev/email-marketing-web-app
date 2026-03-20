import jwt from 'jsonwebtoken';
import { config } from '../config';

interface UnsubscribePayload {
  contactId: string;
  workspaceId: string;
  emailLogId?: string;
}

export function generateUnsubscribeToken(payload: UnsubscribePayload): string {
  return jwt.sign(payload, config.jwt.unsubscribeSecret, { expiresIn: '365d' });
}

export function verifyUnsubscribeToken(token: string): UnsubscribePayload {
  return jwt.verify(token, config.jwt.unsubscribeSecret) as UnsubscribePayload;
}

export function generateUnsubscribeUrl(contactId: string, workspaceId: string, emailLogId?: string): string {
  const token = generateUnsubscribeToken({ contactId, workspaceId, emailLogId });
  return `${config.baseUrl}/unsubscribe?token=${encodeURIComponent(token)}`;
}

export function injectUnsubscribeLink(html: string, contactId: string, workspaceId: string, emailLogId?: string): string {
  const url = generateUnsubscribeUrl(contactId, workspaceId, emailLogId);
  let result = html.replace(/\{\{UNSUBSCRIBE_LINK\}\}/g, url);

  // If no placeholder found, append footer
  if (!html.includes('{{UNSUBSCRIBE_LINK}}') && !result.includes(url)) {
    const footer = `
      <div style="text-align:center;font-size:11px;color:#999;margin-top:40px;padding-top:20px;border-top:1px solid #eee;">
        <p>You received this email because you are a valued contact.</p>
        <p><a href="${url}" style="color:#999;text-decoration:underline;">Unsubscribe from future emails</a></p>
      </div>`;

    if (result.includes('</body>')) {
      result = result.replace('</body>', `${footer}</body>`);
    } else {
      result += footer;
    }
  }

  return result;
}
