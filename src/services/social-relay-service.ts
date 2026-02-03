import type { NitterClient } from '../clients/nitter-client.js';
import type { TelegramClient } from '../clients/telegram-client.js';
import type { DiscordClient } from '../clients/discord-client.js';
import type { TweetRepository } from '../db/tweet-repository.js';
import type { ParsedTweet } from '../clients/telegram-client.js';
import { RSSParser } from '../utils/rss-parser.js';
import type { Logger } from '../utils/logger.js';

/**
 * Processing result for a single poll cycle
 */
export interface ProcessingResult {
  totalFetched: number;
  newTweets: number;
  telegramSuccess: number;
  telegramFailed: number;
  discordSuccess: number;
  discordFailed: number;
  errors: string[];
}

/**
 * SocialRelayService - Main orchestration service
 * Coordinates fetching, deduplication, and posting
 */
export class SocialRelayService {
  private nitterClient: NitterClient;
  private telegramClient: TelegramClient;
  private discordClient: DiscordClient;
  private tweetRepository: TweetRepository;
  private rssParser: RSSParser;
  private logger: Logger;
  
  // Track consecutive failures for alerting
  private consecutiveFailures: number = 0;
  private readonly FAILURE_THRESHOLD: number = 3;
  private alertSent: boolean = false;

  constructor(
    nitterClient: NitterClient,
    telegramClient: TelegramClient,
    discordClient: DiscordClient,
    tweetRepository: TweetRepository,
    logger: Logger
  ) {
    this.nitterClient = nitterClient;
    this.telegramClient = telegramClient;
    this.discordClient = discordClient;
    this.tweetRepository = tweetRepository;
    this.logger = logger.child({ component: 'SocialRelayService' });
    this.rssParser = new RSSParser(logger);
  }

  /**
   * Main processing loop - fetch RSS, filter new tweets, post to channels
   */
  async process(): Promise<ProcessingResult> {
    const result: ProcessingResult = {
      totalFetched: 0,
      newTweets: 0,
      telegramSuccess: 0,
      telegramFailed: 0,
      discordSuccess: 0,
      discordFailed: 0,
      errors: [],
    };

    this.logger.info('Starting processing cycle');

    try {
      // Step 1: Fetch RSS feed
      const xmlContent = await this.nitterClient.fetchRSS();
      
      // Step 2: Parse RSS to tweets
      const feed = this.rssParser.parse(xmlContent);
      const allTweets = this.rssParser.toTweets(feed);
      result.totalFetched = allTweets.length;

      if (allTweets.length === 0) {
        this.logger.info('No tweets found in RSS feed');
        return result;
      }

      this.logger.debug({ tweetCount: allTweets.length }, 'Tweets fetched from RSS');

      // Step 3: Filter out already processed tweets
      const tweetIds = allTweets.map((t) => t.id);
      const existingIds = await this.tweetRepository.filterExisting(tweetIds);
      const newTweets = allTweets.filter((t) => !existingIds.has(t.id));
      result.newTweets = newTweets.length;

      if (newTweets.length === 0) {
        this.logger.info({ totalFetched: result.totalFetched }, 'No new tweets to process');
        return result;
      }

      // Check if this is the first run (no tweets in DB yet)
      const isFirstRun = existingIds.size === 0 && newTweets.length === result.totalFetched;

      if (isFirstRun && newTweets.length > 1) {
        this.logger.info({ 
          totalTweets: newTweets.length 
        }, 'First run detected - marking old tweets as processed, only sending the latest');

        // Sort by date descending (newest first) - allTweets should already be sorted this way from RSS
        // The first tweet is the most recent one
        const latestTweet = newTweets[0]!;
        const olderTweets = newTweets.slice(1);

        // Mark all older tweets as processed without sending
        for (const tweet of olderTweets) {
          await this.tweetRepository.markAsProcessed(tweet.id, tweet.publishedAt);
        }
        this.logger.info({ count: olderTweets.length }, 'Marked older tweets as processed (not sent)');

        // Only process the latest tweet
        await this.processSingleTweet(latestTweet, result);
        result.newTweets = 1;
      } else {
        this.logger.info({ 
          newTweets: newTweets.length, 
          alreadyProcessed: existingIds.size 
        }, 'New tweets to process');

        // Step 4: Process each new tweet (oldest first)
        for (const tweet of newTweets) {
          await this.processSingleTweet(tweet, result);
        }
      }

      this.logger.info({
        ...result,
        errors: result.errors.length,
      }, 'Processing cycle completed');

      // Reset failure counter on success
      if (this.consecutiveFailures > 0) {
        this.logger.info({ previousFailures: this.consecutiveFailures }, 'Nitter recovered, resetting failure counter');
        this.consecutiveFailures = 0;
        this.alertSent = false;
      }

      return result;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      result.errors.push(errorMessage);
      this.logger.error({ err }, 'Processing cycle failed');
      
      // Track consecutive failures and send alert if threshold reached
      this.consecutiveFailures++;
      this.logger.warn({ 
        consecutiveFailures: this.consecutiveFailures,
        threshold: this.FAILURE_THRESHOLD 
      }, 'Nitter fetch failure tracked');

      if (this.consecutiveFailures >= this.FAILURE_THRESHOLD && !this.alertSent) {
        await this.sendNitterFailureAlert(errorMessage);
        this.alertSent = true;
      }

      return result;
    }
  }

  /**
   * Send alert when Nitter fails repeatedly
   */
  private async sendNitterFailureAlert(errorMessage: string): Promise<void> {
    const alertTitle = 'Nitter RSS Feed Failure';
    const alertBody = [
      `The bot has failed to fetch tweets ${this.consecutiveFailures} times in a row.`,
      '',
      '**Possible causes:**',
      '• Twitter session cookies expired',
      '• Twitter account suspended/banned',
      '• Nitter container stopped or crashed',
      '• Network connectivity issues',
      '',
      `**Last error:** ${errorMessage}`,
      '',
      '**Action required:** Check Nitter logs and session status.',
      '```bash',
      'docker logs nitter --tail 50',
      '```',
    ].join('\n');

    try {
      await this.discordClient.sendAlert(alertTitle, alertBody);
      this.logger.info('Nitter failure alert sent to Discord');
    } catch (alertErr) {
      this.logger.error({ err: alertErr }, 'Failed to send Nitter failure alert');
    }
  }

  /**
   * Process a single tweet - post to channels and mark as processed
   */
  private async processSingleTweet(
    tweet: ParsedTweet, 
    result: ProcessingResult
  ): Promise<void> {
    this.logger.debug({ tweetId: tweet.id }, 'Processing tweet');

    let telegramSuccess = false;
    let discordSuccess = false;

    // Post to Telegram
    try {
      telegramSuccess = await this.telegramClient.sendTweet(tweet);
      if (telegramSuccess) {
        result.telegramSuccess++;
      } else {
        result.telegramFailed++;
        result.errors.push(`Telegram send failed for tweet ${tweet.id}`);
      }
    } catch (err) {
      result.telegramFailed++;
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      result.errors.push(`Telegram error for tweet ${tweet.id}: ${errorMessage}`);
      this.logger.error({ err, tweetId: tweet.id }, 'Telegram send threw exception');
    }

    // Post to Discord
    try {
      discordSuccess = await this.discordClient.sendTweet(tweet);
      if (discordSuccess) {
        result.discordSuccess++;
      } else {
        result.discordFailed++;
        result.errors.push(`Discord send failed for tweet ${tweet.id}`);
      }
    } catch (err) {
      result.discordFailed++;
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      result.errors.push(`Discord error for tweet ${tweet.id}: ${errorMessage}`);
      this.logger.error({ err, tweetId: tweet.id }, 'Discord send threw exception');
    }

    // Mark as processed if at least one channel succeeded
    // This prevents infinite retries while allowing the other channel to catch up
    if (telegramSuccess || discordSuccess) {
      try {
        await this.tweetRepository.markAsProcessed(tweet.id, tweet.publishedAt);
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : 'Unknown error';
        result.errors.push(`DB error for tweet ${tweet.id}: ${errorMessage}`);
        this.logger.error({ err, tweetId: tweet.id }, 'Failed to mark tweet as processed');
        // Note: Tweet was already posted, so we continue
        // It may be re-processed on next cycle, but channels should handle duplicates gracefully
      }
    }

    // Small delay between tweets to avoid rate limiting
    await this.sleep(1000);
  }

  /**
   * Perform health checks on all services
   */
  async healthCheck(): Promise<{
    nitter: boolean;
    telegram: boolean;
    discord: boolean;
    database: boolean;
  }> {
    const [nitter, telegram, discord] = await Promise.all([
      this.nitterClient.healthCheck(),
      this.telegramClient.healthCheck(),
      Promise.resolve(this.discordClient.healthCheck()),
    ]);

    // Database health check is done via repository
    const database = await this.checkDatabaseHealth();

    return { nitter, telegram, discord, database };
  }

  /**
   * Check database health
   */
  private async checkDatabaseHealth(): Promise<boolean> {
    try {
      await this.tweetRepository.getCount();
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Sleep utility
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
