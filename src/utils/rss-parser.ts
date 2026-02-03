import { XMLParser, type X2jOptions } from 'fast-xml-parser';
import type { RSSItem, RSSFeed } from '../clients/nitter-client.js';
import type { ParsedTweet } from '../clients/telegram-client.js';
import type { Logger } from './logger.js';

/**
 * RSS XML structure from Nitter
 */
interface RSSXml {
  rss?: {
    channel?: {
      title?: string;
      description?: string;
      lastBuildDate?: string;
      item?: RSSItemXml | RSSItemXml[];
    };
  };
}

interface RSSItemXml {
  title?: string;
  link?: string;
  pubDate?: string;
  description?: string;
  guid?: string | { '#text'?: string };
}

/**
 * RSSParser - Safely parses Nitter RSS XML feeds
 */
export class RSSParser {
  private parser: XMLParser;
  private logger: Logger;

  constructor(logger: Logger) {
    this.logger = logger.child({ component: 'RSSParser' });

    const parserOptions: X2jOptions = {
      ignoreAttributes: false,
      attributeNamePrefix: '@_',
      textNodeName: '#text',
      parseAttributeValue: false,
      trimValues: true,
      parseTagValue: false,
      isArray: (name) => name === 'item', // Always treat 'item' as array
    };

    this.parser = new XMLParser(parserOptions);
  }

  /**
   * Parse RSS XML string to structured feed
   */
  parse(xmlContent: string): RSSFeed {
    if (!xmlContent || xmlContent.trim().length === 0) {
      this.logger.warn('Empty XML content provided');
      return { items: [] };
    }

    try {
      const parsed = this.parser.parse(xmlContent) as RSSXml;
      
      if (!parsed.rss?.channel) {
        this.logger.warn('Invalid RSS structure: missing rss.channel');
        return { items: [] };
      }

      const channel = parsed.rss.channel;
      const rawItems = channel.item ?? [];
      
      // Normalize to array
      const itemsArray = Array.isArray(rawItems) ? rawItems : [rawItems];
      
      const items: RSSItem[] = itemsArray
        .filter((item): item is RSSItemXml => item !== null && item !== undefined)
        .map((item) => this.parseItem(item))
        .filter((item): item is RSSItem => item !== null);

      this.logger.debug({ itemCount: items.length }, 'RSS feed parsed');

      return {
        items,
        title: channel.title,
        description: channel.description,
        lastBuildDate: channel.lastBuildDate,
      };
    } catch (err) {
      this.logger.error({ err }, 'Failed to parse RSS XML');
      throw new Error(`RSS parsing failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
    }
  }

  /**
   * Parse a single RSS item
   */
  private parseItem(item: RSSItemXml): RSSItem | null {
    const link = item.link;
    const pubDate = item.pubDate;

    if (!link || !pubDate) {
      this.logger.debug({ item }, 'Skipping item with missing link or pubDate');
      return null;
    }

    // Extract guid (can be string or object with #text)
    let guid: string | undefined;
    if (typeof item.guid === 'string') {
      guid = item.guid;
    } else if (item.guid && typeof item.guid['#text'] === 'string') {
      guid = item.guid['#text'];
    }

    return {
      title: item.title ?? '',
      link,
      pubDate,
      description: item.description,
      guid,
    };
  }

  /**
   * Convert RSS items to ParsedTweets sorted oldest first
   */
  toTweets(feed: RSSFeed): ParsedTweet[] {
    const tweets: ParsedTweet[] = [];

    for (const item of feed.items) {
      const tweet = this.rssItemToTweet(item);
      if (tweet) {
        tweets.push(tweet);
      }
    }

    // Sort by published date, oldest first (for chronological processing)
    tweets.sort((a, b) => a.publishedAt.getTime() - b.publishedAt.getTime());

    this.logger.debug({ tweetCount: tweets.length }, 'Converted RSS items to tweets');
    return tweets;
  }

  /**
   * Convert a single RSS item to ParsedTweet
   */
  private rssItemToTweet(item: RSSItem): ParsedTweet | null {
    const tweetId = this.extractTweetId(item.link);
    if (!tweetId) {
      this.logger.debug({ link: item.link }, 'Could not extract tweet ID from link');
      return null;
    }

    const publishedAt = this.parseDate(item.pubDate);
    if (!publishedAt) {
      this.logger.debug({ pubDate: item.pubDate }, 'Could not parse publication date');
      return null;
    }

    // Use title as tweet text (Nitter puts tweet content in title)
    // Clean up the text
    const text = this.cleanTweetText(item.title);

    // Skip retweets (start with "RT @")
    if (this.isRetweet(text)) {
      this.logger.debug({ tweetId, text: text.substring(0, 50) }, 'Skipping retweet');
      return null;
    }

    // Skip replies (start with "@" or "R @")
    if (this.isReply(text)) {
      this.logger.debug({ tweetId, text: text.substring(0, 50) }, 'Skipping reply');
      return null;
    }

    // Convert Nitter localhost link to proper X.com link
    const twitterLink = this.convertToTwitterLink(item.link);

    return {
      id: tweetId,
      text,
      link: twitterLink,
      publishedAt,
    };
  }

  /**
   * Convert Nitter URL to Twitter/X URL
   * Example: http://localhost:8080/NEARMobile_app/status/1234567890123456789#m -> https://x.com/NEARMobile_app/status/1234567890123456789
   */
  private convertToTwitterLink(nitterLink: string): string {
    // Extract username and status ID from the Nitter link
    // Pattern: http://localhost[:port]/username/status/id[#m]
    const match = nitterLink.match(/\/([^\/]+)\/status\/(\d+)/);
    if (match && match[1] && match[2]) {
      return `https://x.com/${match[1]}/status/${match[2]}`;
    }
    // Fallback: just replace localhost with x.com and remove #m
    return nitterLink
      .replace(/http:\/\/localhost(:\d+)?/, 'https://x.com')
      .replace(/#m$/, '');
  }

  /**
   * Extract tweet ID from Nitter URL
   * Example: http://localhost:8080/NEARMobile_app/status/1234567890123456789#m
   */
  private extractTweetId(link: string): string | null {
    // Match pattern: /status/[tweet_id]
    const match = link.match(/\/status\/(\d+)/);
    return match ? match[1] ?? null : null;
  }

  /**
   * Check if text is a retweet
   */
  private isRetweet(text: string): boolean {
    // Retweets typically start with "RT @username:"
    return text.trimStart().startsWith('RT @');
  }

  /**
   * Check if text is a reply
   */
  private isReply(text: string): boolean {
    const trimmed = text.trimStart();
    // Replies start with @username or "R @" (Nitter format)
    return trimmed.startsWith('@') || trimmed.startsWith('R @');
  }

  /**
   * Parse RFC 2822 date format used in RSS
   */
  private parseDate(dateStr: string): Date | null {
    try {
      const date = new Date(dateStr);
      if (isNaN(date.getTime())) {
        return null;
      }
      return date;
    } catch {
      return null;
    }
  }

  /**
   * Clean tweet text
   */
  private cleanTweetText(text: string): string {
    return text
      // Decode HTML entities
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      // Normalize whitespace
      .replace(/\s+/g, ' ')
      .trim();
  }
}
