import { Request, Response, NextFunction } from 'express';

type ValidationRule = {
  field: string;
  required?: boolean;
  type?: 'string' | 'number' | 'boolean' | 'email' | 'uuid' | 'array';
  minLength?: number;
  maxLength?: number;
  min?: number;
  max?: number;
  pattern?: RegExp;
  message?: string;
};

export function validate(rules: ValidationRule[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const errors: string[] = [];
    const body = req.body;

    for (const rule of rules) {
      const value = body[rule.field];

      if (rule.required && (value === undefined || value === null || value === '')) {
        errors.push(rule.message || `${rule.field} is required`);
        continue;
      }

      if (value === undefined || value === null) continue;

      if (rule.type === 'email') {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (typeof value !== 'string' || !emailRegex.test(value)) {
          errors.push(rule.message || `${rule.field} must be a valid email`);
        }
      }

      if (rule.type === 'uuid') {
        const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        if (typeof value !== 'string' || !uuidRegex.test(value)) {
          errors.push(rule.message || `${rule.field} must be a valid UUID`);
        }
      }

      if (rule.type === 'string' && typeof value !== 'string') {
        errors.push(rule.message || `${rule.field} must be a string`);
      }

      if (rule.type === 'number' && typeof value !== 'number') {
        errors.push(rule.message || `${rule.field} must be a number`);
      }

      if (rule.type === 'boolean' && typeof value !== 'boolean') {
        errors.push(rule.message || `${rule.field} must be a boolean`);
      }

      if (rule.type === 'array' && !Array.isArray(value)) {
        errors.push(rule.message || `${rule.field} must be an array`);
      }

      if (rule.minLength && typeof value === 'string' && value.length < rule.minLength) {
        errors.push(rule.message || `${rule.field} must be at least ${rule.minLength} characters`);
      }

      if (rule.maxLength && typeof value === 'string' && value.length > rule.maxLength) {
        errors.push(rule.message || `${rule.field} must be at most ${rule.maxLength} characters`);
      }

      if (rule.min !== undefined && typeof value === 'number' && value < rule.min) {
        errors.push(rule.message || `${rule.field} must be at least ${rule.min}`);
      }

      if (rule.max !== undefined && typeof value === 'number' && value > rule.max) {
        errors.push(rule.message || `${rule.field} must be at most ${rule.max}`);
      }

      if (rule.pattern && typeof value === 'string' && !rule.pattern.test(value)) {
        errors.push(rule.message || `${rule.field} has an invalid format`);
      }
    }

    if (errors.length > 0) {
      res.status(400).json({ error: 'Validation failed', details: errors });
      return;
    }

    next();
  };
}

export function sanitizeString(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}

export function sanitizeEmail(email: string): string {
  return email.trim().toLowerCase();
}
