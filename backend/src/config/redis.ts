import Redis from 'ioredis';

const redisUrl = new URL(process.env.REDIS_URL!);

export const redisConnection = new Redis(process.env.REDIS_URL!, {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
});

redisConnection.on('error', (err) => {
  console.error('Redis connection error:', err.message);
});

redisConnection.on('connect', () => {
  console.log('Redis connected');
});

export function createRedisConnection() {
  return {
    host: redisUrl.hostname,
    port: Number(redisUrl.port || 6379),
    username: decodeURIComponent(redisUrl.username || 'default'),
    password: decodeURIComponent(redisUrl.password),
    tls: {},
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  };
}xx