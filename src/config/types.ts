/**
 * Configuration Types
 * Strict typing for all environment variables
 */

export interface NitterConfig {
  baseUrl: string;
  username: string;
}

export interface DatabaseConfig {
  connectionString: string;
  poolMax: number;
  idleTimeoutMs: number;
  connectionTimeoutMs: number;
}

export interface TelegramConfig {
  botToken: string;
  channelId: string;
}

export interface DiscordConfig {
  botToken: string;
  channelId: string;
  alertChannelId?: string;
}

export interface PollingConfig {
  cronExpression: string;
}

export interface RetryConfig {
  maxRetries: number;
  retryDelayMs: number;
}

export interface LogConfig {
  level: string;
  pretty: boolean;
}

export interface AppConfig {
  nodeEnv: string;
  nitter: NitterConfig;
  database: DatabaseConfig;
  telegram: TelegramConfig;
  discord: DiscordConfig;
  polling: PollingConfig;
  retry: RetryConfig;
  log: LogConfig;
}
