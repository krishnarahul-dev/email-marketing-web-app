import { config } from '../config';
import crypto from 'crypto';

export function generateTrackingPixel(emailLogId: string): string {
  const pixelUrl = `${config.baseUrl}/track/open?lid=${encodeURIComponent(emailLogId)}`;
  return `<img src="${pixelUrl}" width="1" height="1" style="display:none;width:1px;height:1px;border:0;" alt="" />`;
}

export function injectTrackingPixel(html: string, emailLogId: string): string {
  const pixel = generateTrackingPixel(emailLogId);

  if (html.includes('</body>')) {
    return html.replace('</body>', `${pixel}</body>`);
  }
  return html + pixel;
}

export function rewriteLinksForTracking(html: string, emailLogId: string): string {
  const linkRegex = /<a\s+([^>]*?)href=["']([^"']+)["']([^>]*?)>/gi;

  return html.replace(linkRegex, (match, before, url, after) => {
    // Skip tracking for unsubscribe links and mailto
    if (url.includes('/unsubscribe') || url.startsWith('mailto:') || url.startsWith('#')) {
      return match;
    }

    const trackUrl = `${config.baseUrl}/track/click?lid=${encodeURIComponent(emailLogId)}&url=${encodeURIComponent(url)}&sig=${generateLinkSignature(emailLogId, url)}`;
    return `<a ${before}href="${trackUrl}"${after}>`;
  });
}

export function generateLinkSignature(emailLogId: string, url: string): string {
  return crypto
    .createHmac('sha256', config.jwt.secret)
    .update(`${emailLogId}:${url}`)
    .digest('hex')
    .substring(0, 16);
}

export function verifyLinkSignature(emailLogId: string, url: string, sig: string): boolean {
  const expected = generateLinkSignature(emailLogId, url);
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(sig));
}

export function prepareEmailForSending(
  html: string,
  emailLogId: string,
  contactId: string,
  workspaceId: string
): string {
  let result = html;

  // Inject tracking pixel
  result = injectTrackingPixel(result, emailLogId);

  // Rewrite links for click tracking
  result = rewriteLinksForTracking(result, emailLogId);

  return result;
}
