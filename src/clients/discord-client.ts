import { 
  Client, 
  GatewayIntentBits, 
  TextChannel, 
  ChannelType,
} from 'discord.js';
import type { DiscordConfig } from '../config/types.js';
import type { Logger } from 'pino';
import type { ParsedTweet } from './telegram-client.js';

/**
 * DiscordClient - Sends messages to Discord channel using bot
 * Manages bot lifecycle including login and graceful shutdown
 */
export class DiscordClient {
  private client: Client;
  private config: DiscordConfig;
  private logger: Logger;
  private isReady: boolean = false;
  private channel: TextChannel | null = null;

  constructor(config: DiscordConfig, logger: Logger) {
    this.config = config;
    this.logger = logger.child({ component: 'DiscordClient' });

    this.client = new Client({
      intents: [GatewayIntentBits.Guilds],
    });

    this.setupEventHandlers();
  }

  /**
   * Set up Discord client event handlers
   */
  private setupEventHandlers(): void {
    this.client.on('ready', () => {
      this.isReady = true;
      this.logger.info({
        botTag: this.client.user?.tag,
        guildCount: this.client.guilds.cache.size,
      }, 'Discord bot is ready');
    });

    this.client.on('error', (err) => {
      this.logger.error({ err }, 'Discord client error');
    });

    this.client.on('warn', (message) => {
      this.logger.warn({ message }, 'Discord client warning');
    });

    this.client.on('disconnect', () => {
      this.isReady = false;
      this.channel = null;
      this.logger.warn('Discord client disconnected');
    });

    this.client.on('rateLimit', (rateLimitData) => {
      this.logger.warn({ rateLimitData }, 'Discord rate limit hit');
    });
  }

  /**
   * Login to Discord and wait until ready
   */
  async login(): Promise<void> {
    this.logger.info('Logging in to Discord...');

    try {
      await this.client.login(this.config.botToken);
      
      // Wait for ready event
      await this.waitForReady();
      
      // Pre-fetch and validate the channel
      await this.fetchChannel();
      
      this.logger.info('Discord client logged in and ready');
    } catch (err) {
      this.logger.error({ err }, 'Failed to login to Discord');
      throw err;
    }
  }

  /**
   * Wait for the bot to be ready
   */
  private waitForReady(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.isReady) {
        resolve();
        return;
      }

      const timeout = setTimeout(() => {
        reject(new Error('Discord client ready timeout'));
      }, 30000);

      this.client.once('ready', () => {
        clearTimeout(timeout);
        resolve();
      });
    });
  }

  /**
   * Fetch and validate the target channel
   */
  private async fetchChannel(): Promise<TextChannel> {
    if (this.channel) {
      return this.channel;
    }

    try {
      const channel = await this.client.channels.fetch(this.config.channelId);

      if (!channel) {
        throw new Error(`Channel not found: ${this.config.channelId}`);
      }

      if (channel.type !== ChannelType.GuildText) {
        throw new Error(`Channel is not a text channel: ${this.config.channelId}`);
      }

      this.channel = channel as TextChannel;
      this.logger.debug({ 
        channelId: this.config.channelId,
        channelName: this.channel.name,
        guildName: this.channel.guild.name,
      }, 'Discord channel fetched');

      return this.channel;
    } catch (err) {
      this.logger.error({ err, channelId: this.config.channelId }, 'Failed to fetch Discord channel');
      throw err;
    }
  }

  /**
   * Send a tweet to Discord channel
   */
  async sendTweet(tweet: ParsedTweet): Promise<boolean> {
    if (!this.isReady) {
      this.logger.warn({ tweetId: tweet.id }, 'Discord not ready, skipping send');
      return false;
    }

    try {
      const channel = await this.fetchChannel();
      const message = this.formatMessage(tweet);

      await channel.send(message);

      this.logger.info({ tweetId: tweet.id }, 'Tweet sent to Discord');
      return true;
    } catch (err) {
      this.logger.error({ err, tweetId: tweet.id }, 'Failed to send tweet to Discord');
      return false;
    }
  }

  /**
   * Format tweet message for Discord
   */
  private formatMessage(tweet: ParsedTweet): string {
    return [
      '**Bitcoin Light New Post**',
      '',
      tweet.text,
      '',
      `𝕏 : ${tweet.link}`,
    ].join('\n');
  }

  /**
   * Check if Discord client is healthy
   */
  healthCheck(): boolean {
    return this.isReady && this.client.isReady();
  }

  /**
   * Get bot info
   */
  getBotInfo(): { id: string; tag: string } | null {
    if (!this.client.user) {
      return null;
    }
    return {
      id: this.client.user.id,
      tag: this.client.user.tag,
    };
  }

  /**
   * Send an alert message to the alert channel
   */
  async sendAlert(title: string, message: string): Promise<boolean> {
    if (!this.isReady) {
      this.logger.warn('Discord not ready, cannot send alert');
      return false;
    }

    const alertChannelId = this.config.alertChannelId;
    if (!alertChannelId) {
      this.logger.debug('No alert channel configured, skipping alert');
      return false;
    }

    try {
      const channel = await this.client.channels.fetch(alertChannelId);

      if (!channel || channel.type !== ChannelType.GuildText) {
        this.logger.error({ alertChannelId }, 'Alert channel not found or not a text channel');
        return false;
      }

      const alertMessage = [
        '⚠️ **ALERT: BTCLight Nitter Bot**',
        '',
        `**${title}**`,
        '',
        message,
        '',
        `🕐 ${new Date().toISOString()}`,
      ].join('\n');

      await (channel as TextChannel).send(alertMessage);
      this.logger.info({ alertChannelId, title }, 'Alert sent to Discord');
      return true;
    } catch (err) {
      this.logger.error({ err, alertChannelId }, 'Failed to send alert to Discord');
      return false;
    }
  }

  /**
   * Gracefully close the Discord client
   */
  async close(): Promise<void> {
    this.logger.info('Closing Discord client...');
    this.isReady = false;
    this.channel = null;
    await this.client.destroy();
    this.logger.info('Discord client closed');
  }
}
