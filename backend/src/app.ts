import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import rateLimit from 'express-rate-limit';
import { config } from './config';
import { errorHandler, notFoundHandler } from './middleware/errorHandler';

// Routes
import authRoutes from './routes/auth';
import contactRoutes from './routes/contacts';
import campaignRoutes from './routes/campaigns';
import sequenceRoutes from './routes/sequences';
import templateRoutes from './routes/templates';
import webhookRoutes from './routes/webhooks';
import trackingRoutes from './routes/tracking';
import analyticsRoutes from './routes/analytics';

const app = express();

// Security headers
app.use(helmet({
  contentSecurityPolicy: false, // Disabled for tracking pixel
  crossOriginResourcePolicy: { policy: 'cross-origin' },
}));

// CORS
app.use(cors({
  origin: config.frontendUrl,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

// Compression
app.use(compression());

// Body parsing
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Trust proxy for rate limiting behind reverse proxy
app.set('trust proxy', 1);

// Rate limiting - general API
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 500,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later' },
});

// Stricter rate limit for auth
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { error: 'Too many auth attempts, please try again later' },
});

// Health check
app.get('/health', async (_req, res) => {
  const { healthCheck } = await import('./config/database');
  const dbHealthy = await healthCheck();
  res.status(dbHealthy ? 200 : 503).json({
    status: dbHealthy ? 'healthy' : 'degraded',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
});

// Mount routes
app.use('/api/auth', authLimiter, authRoutes);
app.use('/api/contacts', apiLimiter, contactRoutes);
app.use('/api/campaigns', apiLimiter, campaignRoutes);
app.use('/api/sequences', apiLimiter, sequenceRoutes);
app.use('/api/templates', apiLimiter, templateRoutes);
app.use('/api/analytics', apiLimiter, analyticsRoutes);

// Webhooks (no rate limit - external services)
app.use('/api/webhooks', webhookRoutes);

// Tracking (no rate limit - pixel/redirect)
app.use('/', trackingRoutes);

// Error handling
app.use(notFoundHandler);
app.use(errorHandler);

export default app;
