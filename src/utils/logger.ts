import pino, { type Logger as PinoLogger } from 'pino';
import type { LogConfig } from '../config/types.js';

export type Logger = PinoLogger;

/**
 * Create a configured pino logger instance
 */
export function createLogger(config: LogConfig): Logger {
  const options: pino.LoggerOptions = {
    level: config.level,
    base: {
      service: 'nearm-nitter-bot',
      pid: process.pid,
    },
    timestamp: pino.stdTimeFunctions.isoTime,
  };

  // Use pino-pretty for development
  if (config.pretty) {
    return pino({
      ...options,
      transport: {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'SYS:standard',
          ignore: 'pid,hostname',
        },
      },
    });
  }

  // Production: structured JSON logging
  return pino(options);
}
