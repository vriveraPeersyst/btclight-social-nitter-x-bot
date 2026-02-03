import type { NitterClient } from '../clients/nitter-client.js';
import type { TelegramClient, ParsedTweet } from '../clients/telegram-client.js';
import type { DiscordClient } from '../clients/discord-client.js';
import type { TweetRepository } from '../db/tweet-repository.js';
import type { RSSParser } from '../utils/rss-parser.js';
import type { Logger } from '../utils/logger.js';

/**
 * Processing result for a single tweet
 */
export interface TweetProcessingResult {
  tweetId: string;
  telegram: boolean;
  discord: boolean;
  dbSaved: boolean;
  skipped: boolean;
  error?: string;
}

/**
 * Polling cycle result
 */
export interface PollingResult {
  success: boolean;
  tweetsFound: number;
  tweetsProcessed: number;
  results: TweetProcessingResult[];
  error?: string;
}

/**
 * Processing result (legacy interface for compatibility)
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
 * SocialRelayService - Orchestrates the tweet relay pipeline
 * Fetches from Nitter → Checks DB → Posts to Telegram + Discord → Saves to DB
 */
export class SocialRelayService {
  private nitterClient: NitterClient;
  private telegramClient: TelegramClient;
  private discordClient: DiscordClient;
  private tweetRepository: TweetRepository;
  private rssParser: RSSParser;
  private logger: Logger;

  constructor(
    nitterClient: NitterClient,
    telegramClient: TelegramClient,
    discordClient: DiscordClient,
    tweetRepository: TweetRepository,
    rssParser: RSSParser,
    logger: Logger
  ) {
    this.nitterClient = nitterClient;
    this.telegramClient = telegramClient;
    this.discordClient = discordClient;
    this.tweetRepository = tweetRepository;
    this.rssParser = rssParser;
    this.logger = logger.child({ component: 'SocialRelayService' });
  }

  /**
   * Execute a polling cycle
   * Fetches RSS, filters new tweets, and posts to channels
   */
  async poll(): Promise<PollingResult> {
    this.logger.info('Starting polling cycle');

    try {
      // Step 1: Fetch RSS feed
      const rssContent = await this.nitterClient.fetchRSS();

      // Step 2: Parse RSS to tweets
      const feed = this.rssParser.parse(rssContent);
      const tweets = this.rssParser.toTweets(feed);

      if (tweets.length === 0) {
        this.logger.info('No tweets found in RSS feed');
        return {
          success: true,
          tweetsFound: 0,
          tweetsProcessed: 0,
          results: [],
        };
      }

      this.logger.info({ tweetCount: tweets.length }, 'Tweets found in RSS feed');

      // Step 3: Filter out already processed tweets
      const tweetIds = tweets.map((t) => t.id);
      const existingIds = await this.tweetRepository.filterExisting(tweetIds);
      const newTweets = tweets.filter((t) => !existingIds.has(t.id));

      if (newTweets.length === 0) {
        this.logger.info('All tweets already processed');
        return {
          success: true,
          tweetsFound: tweets.length,
          tweetsProcessed: 0,
          results: [],
        };
      }

      this.logger.info({ 
        newTweets: newTweets.length, 
        existingTweets: existingIds.size 
      }, 'New tweets to process');

      // Step 4: Process each new tweet
      const results: TweetProcessingResult[] = [];

      for (const tweet of newTweets) {
        const result = await this.processTweet(tweet);
        results.push(result);

        // Small delay between tweets to avoid rate limits
        if (newTweets.indexOf(tweet) < newTweets.length - 1) {
          await this.sleep(1000);
        }
      }

      const successCount = results.filter((r) => r.dbSaved).length;
      this.logger.info({
        processed: successCount,
        total: newTweets.length,
      }, 'Polling cycle completed');

      return {
        success: true,
        tweetsFound: tweets.length,
        tweetsProcessed: successCount,
        results,
      };
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      this.logger.error({ err }, 'Polling cycle failed');

      return {
        success: false,
        tweetsFound: 0,
        tweetsProcessed: 0,
        results: [],
        error: errorMessage,
      };
    }
  }

  /**
   * Process a single tweet
   * Posts to Telegram and Discord, then saves to DB
   */
  private async processTweet(tweet: ParsedTweet): Promise<TweetProcessingResult> {
    this.logger.debug({ tweetId: tweet.id }, 'Processing tweet');

    // Check again if already processed (race condition protection)
    const exists = await this.tweetRepository.exists(tweet.id);
    if (exists) {
      this.logger.debug({ tweetId: tweet.id }, 'Tweet already processed (race condition)');
      return {
        tweetId: tweet.id,
        telegram: false,
        discord: false,
        dbSaved: false,
        skipped: true,
      };
    }

    // Post to Telegram
    const telegramSuccess = await this.telegramClient.sendTweet(tweet);

    // Post to Discord
    const discordSuccess = await this.discordClient.sendTweet(tweet);

    // Only save to DB if at least one channel succeeded
    // This ensures we retry on next poll if both failed
    let dbSaved = false;
    if (telegramSuccess || discordSuccess) {
      try {
        dbSaved = await this.tweetRepository.markAsProcessed(tweet.id, tweet.publishedAt);
      } catch (err) {
        this.logger.error({ err, tweetId: tweet.id }, 'Failed to save tweet to database');
      }
    }

    const result: TweetProcessingResult = {
      tweetId: tweet.id,
      telegram: telegramSuccess,
      discord: discordSuccess,
      dbSaved,
      skipped: false,
    };

    if (!telegramSuccess && !discordSuccess) {
      result.error = 'Both Telegram and Discord failed';
      this.logger.warn({ tweetId: tweet.id }, 'Tweet failed to post to any channel');
    } else if (!telegramSuccess) {
      this.logger.warn({ tweetId: tweet.id }, 'Tweet failed to post to Telegram');
    } else if (!discordSuccess) {
      this.logger.warn({ tweetId: tweet.id }, 'Tweet failed to post to Discord');
    }

    return result;
  }

  /**
   * Sleep for specified milliseconds
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Process method (alias for poll, for backward compatibility)
   */
  async process(): Promise<ProcessingResult> {
    const pollResult = await this.poll();
    
    const telegramSuccess = pollResult.results.filter(r => r.telegram).length;
    const telegramFailed = pollResult.results.filter(r => !r.telegram && !r.skipped).length;
    const discordSuccess = pollResult.results.filter(r => r.discord).length;
    const discordFailed = pollResult.results.filter(r => !r.discord && !r.skipped).length;
    const errors = pollResult.results
      .filter(r => r.error)
      .map(r => `${r.tweetId}: ${r.error}`);
    
    if (pollResult.error) {
      errors.unshift(pollResult.error);
    }

    return {
      totalFetched: pollResult.tweetsFound,
      newTweets: pollResult.tweetsProcessed,
      telegramSuccess,
      telegramFailed,
      discordSuccess,
      discordFailed,
      errors,
    };
  }
}
