import { Telegraf } from 'telegraf';
import type { TelegramConfig } from '../config/types.js';
import type { Logger } from 'pino';

/**
 * Parsed tweet for posting
 */
export interface ParsedTweet {
  id: string;
  text: string;
  link: string;
  publishedAt: Date;
}

/**
 * TelegramClient - Sends messages to Telegram channel
 * Uses Telegraf (no polling, send-only mode)
 */
export class TelegramClient {
  private bot: Telegraf;
  private channelId: string;
  private logger: Logger;

  constructor(config: TelegramConfig, logger: Logger) {
    this.channelId = config.channelId;
    this.logger = logger.child({ component: 'TelegramClient' });

    // Initialize Telegraf bot (no polling needed for send-only)
    this.bot = new Telegraf(config.botToken);

    this.logger.info('Telegram client initialized (send-only mode)');
  }

  /**
   * Send a tweet to Telegram channel
   */
  async sendTweet(tweet: ParsedTweet): Promise<boolean> {
    const message = this.formatMessage(tweet);

    try {
      await this.bot.telegram.sendMessage(this.channelId, message, {
        parse_mode: 'HTML',
        link_preview_options: { is_disabled: false },
      });

      this.logger.info({ tweetId: tweet.id }, 'Tweet sent to Telegram');
      return true;
    } catch (err) {
      this.logger.error({ err, tweetId: tweet.id }, 'Failed to send tweet to Telegram');
      return false;
    }
  }

  /**
   * Format tweet message for Telegram
   */
  private formatMessage(tweet: ParsedTweet): string {
    const escapedText = this.escapeHtml(tweet.text);
    const escapedLink = this.escapeHtml(tweet.link);

    return [
      '<b>Bitcoin Light New Post</b>',
      '',
      escapedText,
      '',
      `𝕏 : ${escapedLink}`,
    ].join('\n');
  }

  /**
   * Escape HTML special characters for Telegram HTML mode
   */
  private escapeHtml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  /**
   * Test bot connectivity
   */
  async healthCheck(): Promise<boolean> {
    try {
      const me = await this.bot.telegram.getMe();
      this.logger.debug({ botUsername: me.username }, 'Telegram bot health check passed');
      return true;
    } catch (err) {
      this.logger.error({ err }, 'Telegram bot health check failed');
      return false;
    }
  }

  /**
   * Get bot info
   */
  async getBotInfo(): Promise<{ id: number; username: string; name: string } | null> {
    try {
      const me = await this.bot.telegram.getMe();
      return {
        id: me.id,
        username: me.username ?? 'unknown',
        name: me.first_name,
      };
    } catch {
      return null;
    }
  }
}
