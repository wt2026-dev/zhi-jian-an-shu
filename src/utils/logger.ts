/**
 * Production-safe logger utility.
 * In development (VITE_DEV_MODE or NODE_ENV=development), logs are emitted to console.
 * In production builds, all log/debug output is suppressed.
 * Error and warn are always emitted (with prefix) for observability.
 */
const isDev = typeof import.meta !== 'undefined'
  ? import.meta.env?.DEV === true
  : process.env.NODE_ENV === 'development';

export const logger = {
  /** Debug-level: removed in production */
  debug: (...args: unknown[]) => {
    if (isDev) console.debug('[DEBUG]', ...args);
  },
  /** Info-level: removed in production */
  info: (...args: unknown[]) => {
    if (isDev) console.info('[INFO]', ...args);
  },
  /** Log-level: removed in production */
  log: (...args: unknown[]) => {
    if (isDev) console.log(...args);
  },
  /** Warn-level: always emitted (red prefix for visibility) */
  warn: (...args: unknown[]) => {
    console.warn('[WARN]', ...args);
  },
  /** Error-level: always emitted */
  error: (...args: unknown[]) => {
    console.error('[ERROR]', ...args);
  },
};

export default logger;
