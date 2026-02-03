import type { DatabaseService } from './database.js';
import type { Logger } from 'pino';

/**
 * Tweet record as stored in database
 */
export interface TweetRecord {
  id: string;
  published_at: Date;
  created_at: Date;
}

/**
 * TweetRepository - Data access layer for tweets_processed table
 * Handles all tweet-related database operations
 */
export class TweetRepository {
  private db: DatabaseService;
  private logger: Logger;

  constructor(db: DatabaseService, logger: Logger) {
    this.db = db;
    this.logger = logger.child({ component: 'TweetRepository' });
  }

  /**
   * Check if a tweet has already been processed
   */
  async exists(tweetId: string): Promise<boolean> {
    const query = 'SELECT 1 FROM tweets_processed WHERE id = $1 LIMIT 1';
    const rows = await this.db.query<{ '?column?': number }>(query, [tweetId]);
    return rows.length > 0;
  }

  /**
   * Check which tweet IDs from a list already exist
   * More efficient than checking one by one
   */
  async filterExisting(tweetIds: string[]): Promise<Set<string>> {
    if (tweetIds.length === 0) {
      return new Set();
    }

    const placeholders = tweetIds.map((_, i) => `$${i + 1}`).join(', ');
    const query = `SELECT id FROM tweets_processed WHERE id IN (${placeholders})`;
    const rows = await this.db.query<{ id: string }>(query, tweetIds);
    
    return new Set(rows.map((row) => row.id));
  }

  /**
   * Mark a tweet as processed
   * Returns true if inserted, false if already existed
   */
  async markAsProcessed(tweetId: string, publishedAt: Date): Promise<boolean> {
    const query = `
      INSERT INTO tweets_processed (id, published_at)
      VALUES ($1, $2)
      ON CONFLICT (id) DO NOTHING
      RETURNING id
    `;

    try {
      const rows = await this.db.query<{ id: string }>(query, [tweetId, publishedAt]);
      const inserted = rows.length > 0;
      
      if (inserted) {
        this.logger.debug({ tweetId }, 'Tweet marked as processed');
      } else {
        this.logger.debug({ tweetId }, 'Tweet already processed (duplicate)');
      }
      
      return inserted;
    } catch (err) {
      this.logger.error({ err, tweetId }, 'Failed to mark tweet as processed');
      throw err;
    }
  }

  /**
   * Get count of processed tweets
   */
  async getCount(): Promise<number> {
    const query = 'SELECT COUNT(*) as count FROM tweets_processed';
    const rows = await this.db.query<{ count: string }>(query);
    const firstRow = rows[0];
    return firstRow ? parseInt(firstRow.count, 10) : 0;
  }

  /**
   * Get recently processed tweets
   */
  async getRecent(limit: number = 10): Promise<TweetRecord[]> {
    const query = `
      SELECT id, published_at, created_at 
      FROM tweets_processed 
      ORDER BY created_at DESC 
      LIMIT $1
    `;
    return this.db.query<TweetRecord>(query, [limit]);
  }

  /**
   * Cleanup old records (optional maintenance)
   */
  async cleanupOld(daysToKeep: number = 90): Promise<number> {
    const query = `
      DELETE FROM tweets_processed 
      WHERE created_at < NOW() - INTERVAL '1 day' * $1
    `;
    
    const client = await this.db.getClient();
    try {
      const result = await client.query(query, [daysToKeep]);
      const deletedCount = result.rowCount ?? 0;
      
      if (deletedCount > 0) {
        this.logger.info({ deletedCount, daysToKeep }, 'Cleaned up old tweet records');
      }
      
      return deletedCount;
    } finally {
      client.release();
    }
  }
}
