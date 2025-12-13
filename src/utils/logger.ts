type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

let currentLevel: LogLevel = 'info';

/**
 * Set the minimum log level. Messages below this level will be ignored.
 */
export function setLogLevel(level: LogLevel): void {
  currentLevel = level;
}

/**
 * Get the current log level.
 */
export function getLogLevel(): LogLevel {
  return currentLevel;
}

function shouldLog(level: LogLevel): boolean {
  return LOG_LEVELS[level] >= LOG_LEVELS[currentLevel];
}

function formatMessage(level: LogLevel, message: string, meta?: object): string {
  const timestamp = new Date().toISOString();
  const metaStr = meta ? ` ${JSON.stringify(meta)}` : '';
  return `[${timestamp}] [${level.toUpperCase()}] ${message}${metaStr}`;
}

/**
 * Log to stderr (MCP uses stdout for protocol messages).
 */
function log(level: LogLevel, message: string, meta?: object): void {
  if (!shouldLog(level)) return;
  console.error(formatMessage(level, message, meta));
}

export const logger = {
  debug: (message: string, meta?: object) => log('debug', message, meta),
  info: (message: string, meta?: object) => log('info', message, meta),
  warn: (message: string, meta?: object) => log('warn', message, meta),
  error: (message: string, meta?: object) => log('error', message, meta),

  /** Log with timing information */
  timed: <T>(label: string, fn: () => T): T => {
    const start = performance.now();
    try {
      const result = fn();
      const duration = performance.now() - start;
      log('debug', `${label} completed`, { durationMs: duration.toFixed(2) });
      return result;
    } catch (err) {
      const duration = performance.now() - start;
      log('error', `${label} failed`, { durationMs: duration.toFixed(2) });
      throw err;
    }
  },

  /** Log with async timing information */
  timedAsync: async <T>(label: string, fn: () => Promise<T>): Promise<T> => {
    const start = performance.now();
    try {
      const result = await fn();
      const duration = performance.now() - start;
      log('debug', `${label} completed`, { durationMs: duration.toFixed(2) });
      return result;
    } catch (err) {
      const duration = performance.now() - start;
      log('error', `${label} failed`, { durationMs: duration.toFixed(2) });
      throw err;
    }
  },
};
