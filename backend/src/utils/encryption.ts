import crypto from 'crypto';
import { config } from '../config';

/**
 * AES-256-GCM symmetric encryption for storing AWS credentials and other secrets at rest.
 * Uses the JWT secret as the encryption key source (derived via SHA-256 to get exact 32 bytes).
 *
 * Format of encrypted output: base64(iv:authTag:ciphertext)
 *
 * Security notes:
 * - Uses authenticated encryption (GCM mode) — tampered ciphertext will fail to decrypt
 * - Random IV per encryption — same plaintext produces different ciphertext each time
 * - Key is derived from JWT_SECRET; rotating JWT secret invalidates all encrypted data
 *
 * This is sufficient for protecting AWS credentials in the database.
 * For higher-security environments, consider AWS KMS or HashiCorp Vault.
 */

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;

function getKey(): Buffer {
  // Derive a deterministic 32-byte key from the JWT secret
  return crypto.createHash('sha256').update(config.jwt.secret).digest();
}

export function encrypt(plaintext: string): string {
  if (!plaintext) return '';
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, getKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  // Combine iv + authTag + ciphertext, base64-encode
  return Buffer.concat([iv, authTag, encrypted]).toString('base64');
}

export function decrypt(ciphertext: string): string {
  if (!ciphertext) return '';
  try {
    const data = Buffer.from(ciphertext, 'base64');
    if (data.length < IV_LENGTH + AUTH_TAG_LENGTH) {
      throw new Error('Ciphertext too short');
    }
    const iv = data.subarray(0, IV_LENGTH);
    const authTag = data.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
    const encrypted = data.subarray(IV_LENGTH + AUTH_TAG_LENGTH);
    const decipher = crypto.createDecipheriv(ALGORITHM, getKey(), iv);
    decipher.setAuthTag(authTag);
    const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
    return decrypted.toString('utf8');
  } catch (err: any) {
    throw new Error(`Decryption failed: ${err.message}`);
  }
}

/**
 * Mask a credential for display (show first 4 + last 4 characters).
 * Use this to confirm a credential is set without revealing it in API responses.
 */
export function mask(value: string | null): string {
  if (!value) return '';
  if (value.length <= 8) return '••••••••';
  return value.substring(0, 4) + '••••••••' + value.substring(value.length - 4);
}
