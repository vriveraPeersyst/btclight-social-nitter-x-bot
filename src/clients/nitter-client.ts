import axios, { AxiosInstance, AxiosError } from 'axios';
import type { NitterConfig, RetryConfig } from '../config/types.js';
import type { Logger } from 'pino';

/**
 * Raw RSS item from Nitter feed
 */
export interface RSSItem {
  title: string;
  link: string;
  pubDate: string;
  description?: string;
  guid?: string;
}

/**
 * Parsed RSS feed structure
 */
export interface RSSFeed {
  items: RSSItem[];
  title?: string;
  description?: string;
  lastBuildDate?: string;
}

/**
 * NitterClient - Fetches RSS feed from self-hosted Nitter instance
 */
export class NitterClient {
  private client: AxiosInstance;
  private config: NitterConfig;
  private retryConfig: RetryConfig;
  private logger: Logger;

  constructor(config: NitterConfig, retryConfig: RetryConfig, logger: Logger) {
    this.config = config;
    this.retryConfig = retryConfig;
    this.logger = logger.child({ component: 'NitterClient' });

    this.client = axios.create({
      baseURL: config.baseUrl,
      timeout: 30000,
      headers: {
        'Accept': 'application/rss+xml, application/xml, text/xml',
        'User-Agent': 'NEARM-Social-Bot/1.0',
      },
    });
  }

  /**
   * Fetch RSS feed with retry logic
   */
  async fetchRSS(): Promise<string> {
    const url = `/${this.config.username}/rss`;
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= this.retryConfig.maxRetries; attempt++) {
      try {
        this.logger.debug({ url, attempt }, 'Fetching RSS feed');
        
        const response = await this.client.get<string>(url, {
          responseType: 'text',
        });

        if (!response.data || response.data.trim().length === 0) {
          throw new Error('Empty RSS feed response');
        }

        this.logger.debug({ 
          url, 
          contentLength: response.data.length,
          attempt 
        }, 'RSS feed fetched successfully');

        return response.data;
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        
        const isRetryable = this.isRetryableError(err);
        const isLastAttempt = attempt === this.retryConfig.maxRetries;

        this.logger.warn({
          err: lastError,
          url,
          attempt,
          isRetryable,
          isLastAttempt,
        }, 'RSS fetch attempt failed');

        if (!isRetryable || isLastAttempt) {
          break;
        }

        // Wait before retry with exponential backoff
        const delay = this.retryConfig.retryDelayMs * Math.pow(2, attempt - 1);
        await this.sleep(delay);
      }
    }

    throw new Error(
      `Failed to fetch RSS after ${this.retryConfig.maxRetries} attempts: ${lastError?.message}`
    );
  }

  /**
   * Check if Nitter instance is healthy
   */
  async healthCheck(): Promise<boolean> {
    try {
      const response = await this.client.get('/', { timeout: 5000 });
      return response.status === 200;
    } catch {
      return false;
    }
  }

  /**
   * Get the RSS feed URL
   */
  getRSSUrl(): string {
    return `${this.config.baseUrl}/${this.config.username}/rss`;
  }

  /**
   * Determine if an error is retryable
   */
  private isRetryableError(err: unknown): boolean {
    if (err instanceof AxiosError) {
      // Network errors are retryable
      if (!err.response) {
        return true;
      }

      // Server errors (5xx) are retryable
      const status = err.response.status;
      if (status >= 500 && status < 600) {
        return true;
      }

      // Rate limiting (429) is retryable
      if (status === 429) {
        return true;
      }
    }

    return false;
  }

  /**
   * Sleep for specified milliseconds
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
