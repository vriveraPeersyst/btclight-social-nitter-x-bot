import 'dotenv/config';
import type { AppConfig } from './types.js';

/**
 * Configuration validation error
 */
class ConfigValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigValidationError';
  }
}

/**
 * Get required environment variable or throw
 */
function requireEnv(key: string): string {
  const value = process.env[key];
  if (value === undefined || value === '') {
    throw new ConfigValidationError(`Missing required environment variable: ${key}`);
  }
  return value;
}

/**
 * Get optional environment variable with default
 */
function optionalEnv(key: string, defaultValue: string): string {
  const value = process.env[key];
  return value !== undefined && value !== '' ? value : defaultValue;
}

/**
 * Parse integer from environment variable
 */
function parseIntEnv(key: string, defaultValue: number): number {
  const value = process.env[key];
  if (value === undefined || value === '') {
    return defaultValue;
  }
  const parsed = parseInt(value, 10);
  if (isNaN(parsed)) {
    throw new ConfigValidationError(`Invalid integer for ${key}: ${value}`);
  }
  return parsed;
}

/**
 * Parse boolean from environment variable
 */
function parseBoolEnv(key: string, defaultValue: boolean): boolean {
  const value = process.env[key];
  if (value === undefined || value === '') {
    return defaultValue;
  }
  return value.toLowerCase() === 'true' || value === '1';
}

/**
 * Validate URL format
 */
function validateUrl(url: string, name: string): string {
  try {
    new URL(url);
    return url;
  } catch {
    throw new ConfigValidationError(`Invalid URL for ${name}: ${url}`);
  }
}

/**
 * Load and validate all configuration
 */
export function loadConfig(): AppConfig {
  const config: AppConfig = {
    nodeEnv: optionalEnv('NODE_ENV', 'development'),

    nitter: {
      baseUrl: validateUrl(requireEnv('NITTER_BASE_URL'), 'NITTER_BASE_URL'),
      username: requireEnv('NITTER_USERNAME'),
    },

    database: {
      connectionString: requireEnv('DATABASE_URL'),
      poolMax: parseIntEnv('DB_POOL_MAX', 10),
      idleTimeoutMs: parseIntEnv('DB_POOL_IDLE_TIMEOUT_MS', 30000),
      connectionTimeoutMs: parseIntEnv('DB_CONNECTION_TIMEOUT_MS', 5000),
    },

    telegram: {
      botToken: requireEnv('TELEGRAM_BOT_TOKEN'),
      channelId: requireEnv('TELEGRAM_CHANNEL_ID'),
    },

    discord: {
      botToken: requireEnv('DISCORD_BOT_TOKEN'),
      channelId: requireEnv('DISCORD_CHANNEL_ID'),
      alertChannelId: optionalEnv('DISCORD_ALERT_CHANNEL_ID', ''),
    },

    polling: {
      cronExpression: optionalEnv('POLL_CRON_EXPRESSION', '*/10 9-20 * * 1-5'),
    },

    retry: {
      maxRetries: parseIntEnv('MAX_RETRIES', 3),
      retryDelayMs: parseIntEnv('RETRY_DELAY_MS', 1000),
    },

    log: {
      level: optionalEnv('LOG_LEVEL', 'info'),
      pretty: parseBoolEnv('LOG_PRETTY', false),
    },
  };

  return config;
}

export type { AppConfig };
