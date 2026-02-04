import cron from 'node-cron';
import { loadConfig } from './config/index.js';
import { createLogger, RSSParser } from './utils/index.js';
import { DatabaseService, TweetRepository } from './db/index.js';
import { NitterClient, TelegramClient, DiscordClient } from './clients/index.js';
import { SocialRelayService } from './services/index.js';

/**
 * NEARM Social Nitter X Bot
 * 
 * Polls Nitter RSS feed and relays new tweets to Telegram and Discord
 */

// Global state for graceful shutdown
let isShuttingDown = false;
let isProcessing = false;
let scheduledTask: cron.ScheduledTask | null = null;
let databaseService: DatabaseService | null = null;
let discordClient: DiscordClient | null = null;

async function main(): Promise<void> {
  // Load and validate configuration
  const config = loadConfig();
  
  // Initialize logger
  const logger = createLogger(config.log);
  logger.info({ nodeEnv: config.nodeEnv }, 'Starting NEARM Social Nitter X Bot');

  try {
    // Initialize database
    databaseService = new DatabaseService(config.database, logger);
    const dbHealthy = await databaseService.healthCheck();
    if (!dbHealthy) {
      throw new Error('Database health check failed');
    }
    logger.info('Database connected');

    // Initialize repositories
    const tweetRepository = new TweetRepository(databaseService, logger);
    const tweetCount = await tweetRepository.getCount();
    logger.info({ processedTweets: tweetCount }, 'Tweet repository initialized');

    // Initialize clients
    const nitterClient = new NitterClient(config.nitter, config.retry, logger);
    const telegramClient = new TelegramClient(config.telegram, logger);
    discordClient = new DiscordClient(config.discord, logger);

    // Login to Discord
    await discordClient.login();

    // Verify Telegram bot
    const telegramHealth = await telegramClient.healthCheck();
    if (!telegramHealth) {
      logger.warn('Telegram bot health check failed - continuing anyway');
    }

    // Check Nitter availability
    const nitterHealth = await nitterClient.healthCheck();
    if (!nitterHealth) {
      logger.warn('Nitter health check failed - continuing anyway');
    }

    // Initialize RSS parser
    const rssParser = new RSSParser(logger);

    // Initialize relay service
    const relayService = new SocialRelayService(
      nitterClient,
      telegramClient,
      discordClient,
      tweetRepository,
      rssParser,
      logger
    );

    // Run once immediately on startup
    logger.info('Running initial processing cycle');
    await runProcessingCycle(relayService, logger);

    // Schedule cron job
    // Default: Every 10 minutes, Monday-Friday, 09:00-20:59 (server time)
    // Cron format: "*/10 9-20 * * 1-5"
    const cronExpression = config.polling.cronExpression;
    
    if (!cron.validate(cronExpression)) {
      throw new Error(`Invalid cron expression: ${cronExpression}`);
    }

    scheduledTask = cron.schedule(cronExpression, async () => {
      if (isShuttingDown) {
        logger.debug('Shutdown in progress, skipping scheduled run');
        return;
      }
      await runProcessingCycle(relayService, logger);
    });

    logger.info({ cronExpression }, 'Cron scheduler started');

    // Set up graceful shutdown handlers
    setupShutdownHandlers(logger);

    // Signal PM2 that we're ready
    if (process.send) {
      process.send('ready');
    }

    logger.info('Bot is running and waiting for scheduled tasks');
  } catch (err) {
    logger.fatal({ err }, 'Failed to start bot');
    await cleanup(logger);
    process.exit(1);
  }
}

/**
 * Run a single processing cycle with error handling
 */
async function runProcessingCycle(
  relayService: SocialRelayService,
  logger: ReturnType<typeof createLogger>
): Promise<void> {
  if (isProcessing) {
    logger.warn('Previous processing cycle still running, skipping');
    return;
  }

  isProcessing = true;
  
  try {
    const result = await relayService.process();
    
    logger.info({
      totalFetched: result.totalFetched,
      newTweets: result.newTweets,
      telegramSuccess: result.telegramSuccess,
      telegramFailed: result.telegramFailed,
      discordSuccess: result.discordSuccess,
      discordFailed: result.discordFailed,
      errorCount: result.errors.length,
    }, 'Processing cycle completed');

    // Send alert if there were errors during processing
    if (result.errors.length > 0 && discordClient) {
      const errorSummary = result.errors.slice(0, 5).join('\n• ');
      const moreErrors = result.errors.length > 5 ? `\n...and ${result.errors.length - 5} more` : '';
      await discordClient.sendAlert(
        'Processing Errors',
        `Encountered ${result.errors.length} error(s) during processing:\n\n• ${errorSummary}${moreErrors}`
      );
    }
  } catch (err) {
    logger.error({ err }, 'Processing cycle failed with unhandled error');
    
    // Send alert for unhandled errors
    if (discordClient) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      await discordClient.sendAlert(
        'Processing Cycle Failed',
        `The bot encountered an unhandled error:\n\n\`\`\`\n${errorMessage}\n\`\`\``
      );
    }
    // Don't crash - let cron retry on next schedule
  } finally {
    isProcessing = false;
  }
}

/**
 * Set up graceful shutdown handlers
 */
function setupShutdownHandlers(logger: ReturnType<typeof createLogger>): void {
  const shutdown = async (signal: string): Promise<void> => {
    if (isShuttingDown) {
      logger.warn({ signal }, 'Shutdown already in progress');
      return;
    }

    isShuttingDown = true;
    logger.info({ signal }, 'Received shutdown signal');

    await cleanup(logger);
    process.exit(0);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  // Handle uncaught errors
  process.on('uncaughtException', (err) => {
    logger.fatal({ err }, 'Uncaught exception');
    shutdown('uncaughtException');
  });

  process.on('unhandledRejection', (reason) => {
    logger.fatal({ reason }, 'Unhandled rejection');
    // Don't exit on unhandled rejection, just log it
  });
}

/**
 * Clean up resources
 */
async function cleanup(logger: ReturnType<typeof createLogger>): Promise<void> {
  logger.info('Cleaning up resources...');

  // Stop cron scheduler
  if (scheduledTask) {
    scheduledTask.stop();
    logger.info('Cron scheduler stopped');
  }

  // Wait for current processing to complete (with timeout)
  if (isProcessing) {
    logger.info('Waiting for current processing to complete...');
    const timeout = 10000;
    const start = Date.now();
    
    while (isProcessing && Date.now() - start < timeout) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    
    if (isProcessing) {
      logger.warn('Processing did not complete within timeout');
    }
  }

  // Close Discord client
  if (discordClient) {
    await discordClient.close();
  }

  // Close database pool
  if (databaseService) {
    await databaseService.close();
  }

  logger.info('Cleanup completed');
}

// Start the application
main().catch((err) => {
  console.error('Fatal error during startup:', err);
  process.exit(1);
});
