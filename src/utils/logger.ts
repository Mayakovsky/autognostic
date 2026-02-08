import { isAutognosticError } from "../errors";

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogEntry {
  level: LogLevel;
  message: string;
  timestamp: string;
  context?: Record<string, unknown>;
  error?: {
    name: string;
    code?: number;
    message: string;
    stack?: string;
  };
}

export interface LoggerConfig {
  prefix: string;
  minLevel: LogLevel;
  includeTimestamp: boolean;
  structuredOutput: boolean;
}

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const DEFAULT_CONFIG: LoggerConfig = {
  prefix: "[autognostic]",
  minLevel: "info",
  includeTimestamp: false,
  structuredOutput: false,
};

/**
 * Structured logger for Autognostic plugin.
 */
class Logger {
  private config: LoggerConfig;

  constructor(config: Partial<LoggerConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  private shouldLog(level: LogLevel): boolean {
    return LOG_LEVELS[level] >= LOG_LEVELS[this.config.minLevel];
  }

  private formatMessage(level: LogLevel, message: string, context?: Record<string, unknown>): string {
    const parts: string[] = [];

    if (this.config.includeTimestamp) {
      parts.push(`[${new Date().toISOString()}]`);
    }

    parts.push(this.config.prefix);
    parts.push(`[${level.toUpperCase()}]`);
    parts.push(message);

    if (context && Object.keys(context).length > 0) {
      const contextStr = Object.entries(context)
        .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
        .join(" ");
      parts.push(`| ${contextStr}`);
    }

    return parts.join(" ");
  }

  private createEntry(level: LogLevel, message: string, context?: Record<string, unknown>, error?: unknown): LogEntry {
    const entry: LogEntry = {
      level,
      message,
      timestamp: new Date().toISOString(),
    };

    if (context) {
      entry.context = context;
    }

    if (error) {
      if (isAutognosticError(error)) {
        entry.error = {
          name: error.name,
          code: error.code,
          message: error.message,
          stack: error.stack,
        };
      } else if (error instanceof Error) {
        entry.error = {
          name: error.name,
          message: error.message,
          stack: error.stack,
        };
      }
    }

    return entry;
  }

  private log(level: LogLevel, message: string, context?: Record<string, unknown>, error?: unknown): void {
    if (!this.shouldLog(level)) return;

    if (this.config.structuredOutput) {
      const entry = this.createEntry(level, message, context, error);
      const consoleFn = level === "error" ? console.error : level === "warn" ? console.warn : console.log;
      consoleFn(JSON.stringify(entry));
    } else {
      const formatted = this.formatMessage(level, message, context);
      switch (level) {
        case "error":
          console.error(formatted);
          if (error) console.error(error);
          break;
        case "warn":
          console.warn(formatted);
          break;
        case "debug":
          console.debug(formatted);
          break;
        default:
          console.log(formatted);
      }
    }
  }

  debug(message: string, context?: Record<string, unknown>): void {
    this.log("debug", message, context);
  }

  info(message: string, context?: Record<string, unknown>): void {
    this.log("info", message, context);
  }

  warn(message: string, context?: Record<string, unknown>, error?: unknown): void {
    this.log("warn", message, context, error);
  }

  error(message: string, context?: Record<string, unknown>, error?: unknown): void {
    this.log("error", message, context, error);
  }

  /**
   * Create a child logger with additional context.
   */
  child(additionalContext: Record<string, unknown>): ContextualLogger {
    return new ContextualLogger(this, additionalContext);
  }

  /**
   * Update logger configuration.
   */
  configure(config: Partial<LoggerConfig>): void {
    this.config = { ...this.config, ...config };
  }
}

/**
 * Logger with persistent context (for request/operation tracking).
 */
class ContextualLogger {
  constructor(
    private parent: Logger,
    private context: Record<string, unknown>
  ) {}

  debug(message: string, additionalContext?: Record<string, unknown>): void {
    this.parent.debug(message, { ...this.context, ...additionalContext });
  }

  info(message: string, additionalContext?: Record<string, unknown>): void {
    this.parent.info(message, { ...this.context, ...additionalContext });
  }

  warn(message: string, additionalContext?: Record<string, unknown>, error?: unknown): void {
    this.parent.warn(message, { ...this.context, ...additionalContext }, error);
  }

  error(message: string, additionalContext?: Record<string, unknown>, error?: unknown): void {
    this.parent.error(message, { ...this.context, ...additionalContext }, error);
  }
}

// Singleton instance
export const logger = new Logger();

// Factory for child loggers
export function createLogger(context: Record<string, unknown>): ContextualLogger {
  return logger.child(context);
}

// Configure based on environment
if (typeof process !== "undefined" && process.env) {
  if (process.env.LOG_LEVEL) {
    logger.configure({ minLevel: process.env.LOG_LEVEL as LogLevel });
  }
  if (process.env.AUTOGNOSTIC_STRUCTURED_LOGS === "true") {
    logger.configure({ structuredOutput: true });
  }
}
