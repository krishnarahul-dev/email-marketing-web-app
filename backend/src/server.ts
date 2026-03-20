import app from './app';
import { config } from './config';
import { startEmailSendWorker } from './workers/emailSendWorker';
import { startSequenceWorker } from './workers/sequenceWorker';
import { startCampaignWorker } from './workers/campaignWorker';
import { startReplyProcessWorker } from './workers/replyProcessWorker';

async function start(): Promise<void> {
  try {
    // Verify database connection
    const { healthCheck } = await import('./config/database');
    const dbOk = await healthCheck();
    if (!dbOk) {
      throw new Error('Database connection failed');
    }
    console.log('Database connected');

    // Start workers
    startEmailSendWorker();
    startSequenceWorker();
    startCampaignWorker();
    startReplyProcessWorker();
    console.log('All workers started');

    // Start HTTP server
    const server = app.listen(config.port, () => {
      console.log(`Server running on port ${config.port} [${config.env}]`);
      console.log(`Base URL: ${config.baseUrl}`);
    });

    // Graceful shutdown
    const shutdown = async (signal: string) => {
      console.log(`\n${signal} received. Shutting down gracefully...`);
      server.close(() => {
        console.log('HTTP server closed');
        process.exit(0);
      });

      // Force exit after 30 seconds
      setTimeout(() => {
        console.error('Forced shutdown after timeout');
        process.exit(1);
      }, 30000);
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));

    process.on('unhandledRejection', (reason: any) => {
      console.error('Unhandled rejection:', reason);
    });

    process.on('uncaughtException', (err) => {
      console.error('Uncaught exception:', err);
      process.exit(1);
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

start();
