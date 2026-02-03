import { Pool, type PoolClient, type PoolConfig } from 'pg';
import type { DatabaseConfig } from '../config/types.js';
import type { Logger } from 'pino';

/**
 * DatabaseService - Manages PostgreSQL connection pool
 * Provides connection pooling and graceful shutdown
 */
export class DatabaseService {
  private pool: Pool;
  private logger: Logger;
  private isShuttingDown = false;

  constructor(config: DatabaseConfig, logger: Logger) {
    this.logger = logger.child({ component: 'DatabaseService' });

    const poolConfig: PoolConfig = {
      connectionString: config.connectionString,
      max: config.poolMax,
      idleTimeoutMillis: config.idleTimeoutMs,
      connectionTimeoutMillis: config.connectionTimeoutMs,
      ssl: config.connectionString.includes('railway')
        ? { rejectUnauthorized: false }
        : undefined,
    };

    this.pool = new Pool(poolConfig);

    // Log pool events
    this.pool.on('connect', () => {
      this.logger.debug('New client connected to pool');
    });

    this.pool.on('error', (err) => {
      this.logger.error({ err }, 'Unexpected pool error');
    });

    this.pool.on('remove', () => {
      this.logger.debug('Client removed from pool');
    });
  }

  /**
   * Get a client from the pool for transaction support
   */
  async getClient(): Promise<PoolClient> {
    if (this.isShuttingDown) {
      throw new Error('Database is shutting down');
    }
    return this.pool.connect();
  }

  /**
   * Execute a query using the pool
   */
  async query<T>(text: string, params?: unknown[]): Promise<T[]> {
    if (this.isShuttingDown) {
      throw new Error('Database is shutting down');
    }

    const start = Date.now();
    try {
      const result = await this.pool.query(text, params);
      const duration = Date.now() - start;
      this.logger.debug({ text, duration, rows: result.rowCount }, 'Query executed');
      return result.rows as T[];
    } catch (err) {
      const duration = Date.now() - start;
      this.logger.error({ err, text, duration }, 'Query failed');
      throw err;
    }
  }

  /**
   * Check if database is healthy
   */
  async healthCheck(): Promise<boolean> {
    try {
      await this.pool.query('SELECT 1');
      return true;
    } catch (err) {
      this.logger.error({ err }, 'Health check failed');
      return false;
    }
  }

  /**
   * Get pool statistics
   */
  getPoolStats(): { total: number; idle: number; waiting: number } {
    return {
      total: this.pool.totalCount,
      idle: this.pool.idleCount,
      waiting: this.pool.waitingCount,
    };
  }

  /**
   * Gracefully close the pool
   */
  async close(): Promise<void> {
    this.isShuttingDown = true;
    this.logger.info('Closing database pool...');
    await this.pool.end();
    this.logger.info('Database pool closed');
  }
}
