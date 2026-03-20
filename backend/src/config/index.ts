import dotenv from 'dotenv';
dotenv.config();

function requireEnv(key: string): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

function optionalEnv(key: string, fallback: string): string {
  return process.env[key] || fallback;
}

export const config = {
  env: optionalEnv('NODE_ENV', 'development'),
  port: parseInt(optionalEnv('PORT', '3001'), 10),
  baseUrl: optionalEnv('BASE_URL', 'http://localhost:3001'),
  frontendUrl: optionalEnv('FRONTEND_URL', 'http://localhost:3000'),

  db: {
    host: optionalEnv('DB_HOST', 'localhost'),
    port: parseInt(optionalEnv('DB_PORT', '5432'), 10),
    database: optionalEnv('DB_NAME', 'emailtool'),
    user: optionalEnv('DB_USER', 'postgres'),
    password: optionalEnv('DB_PASSWORD', 'postgres'),
    ssl: process.env.DB_SSL === 'true',
    max: parseInt(optionalEnv('DB_POOL_MAX', '20'), 10),
  },

  redis: {
    host: optionalEnv('REDIS_HOST', 'localhost'),
    port: parseInt(optionalEnv('REDIS_PORT', '6379'), 10),
    password: process.env.REDIS_PASSWORD || undefined,
  },

  jwt: {
    secret: requireEnv('JWT_SECRET'),
    expiresIn: optionalEnv('JWT_EXPIRES_IN', '7d'),
    unsubscribeSecret: requireEnv('UNSUBSCRIBE_SECRET'),
  },

  ses: {
    region: optionalEnv('SES_REGION', 'us-east-1'),
    accessKeyId: requireEnv('SES_ACCESS_KEY_ID'),
    secretAccessKey: requireEnv('SES_SECRET_ACCESS_KEY'),
    configurationSet: optionalEnv('SES_CONFIGURATION_SET', 'email-tool-tracking'),
  },

  postmark: {
    webhookToken: process.env.POSTMARK_WEBHOOK_TOKEN || '',
  },

  claude: {
    apiKey: requireEnv('CLAUDE_API_KEY'),
    model: optionalEnv('CLAUDE_MODEL', 'claude-sonnet-4-20250514'),
  },

  email: {
    maxBatchSize: parseInt(optionalEnv('EMAIL_MAX_BATCH_SIZE', '50'), 10),
    rateLimitPerSecond: parseInt(optionalEnv('EMAIL_RATE_LIMIT_PER_SECOND', '14'), 10),
    retryAttempts: parseInt(optionalEnv('EMAIL_RETRY_ATTEMPTS', '3'), 10),
    retryDelay: parseInt(optionalEnv('EMAIL_RETRY_DELAY_MS', '5000'), 10),
  },
} as const;
