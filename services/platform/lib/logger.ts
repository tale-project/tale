/**
 * Logger utility for standardized logging in the application
 * Helps with debugging and monitoring the application
 */
export class Logger {
  private readonly namespace: string;

  /**
   * Creates a new logger instance with the given namespace
   * @param namespace The namespace for this logger instance
   */
  constructor(namespace: string) {
    this.namespace = namespace;
  }

  /**
   * Log an info message
   * @param message The message to log
   * @param data Optional data to include in the log
   */
  info(message: string, data?: Record<string, unknown>): void {
    this.log('INFO', message, data);
  }

  /**
   * Log a debug message
   * @param message The message to log
   * @param data Optional data to include in the log
   */
  debug(message: string, data?: Record<string, unknown>): void {
    this.log('DEBUG', message, data);
  }

  /**
   * Log a warning message
   * @param message The message to log
   * @param data Optional data to include in the log
   */
  warn(message: string, data?: Record<string, unknown>): void {
    this.log('WARN', message, data);
  }

  /**
   * Log an error message
   * @param message The message to log
   * @param data Optional data to include in the log
   */
  error(message: string, data?: Record<string, unknown>): void {
    this.log('ERROR', message, data);
  }

  /**
   * Internal method to actually log the message
   * @param level The log level
   * @param message The message to log
   * @param data Optional data to include in the log
   */
  private log(
    level: string,
    message: string,
    data?: Record<string, unknown>,
  ): void {
    const timestamp = new Date().toISOString();
    const logData = {
      timestamp,
      level,
      namespace: this.namespace,
      message,
      ...data,
    };

    // In production, you might want to send logs to a proper logging service
    // For now, we'll just log to the console with a standardized format
    if (level === 'ERROR') {
      console.error(
        JSON.stringify(
          logData,
          null,
          process.env.NODE_ENV === 'development' ? 2 : 0,
        ),
      );
    } else if (level === 'WARN') {
      console.warn(
        JSON.stringify(
          logData,
          null,
          process.env.NODE_ENV === 'development' ? 2 : 0,
        ),
      );
    } else if (level === 'DEBUG') {
      // Only log debug messages in development
      if (
        process.env.NODE_ENV === 'development' ||
        process.env.DEBUG === 'true'
      ) {
        console.debug(JSON.stringify(logData, null, 2));
      }
    } else {
      console.log(
        JSON.stringify(
          logData,
          null,
          process.env.NODE_ENV === 'development' ? 2 : 0,
        ),
      );
    }
  }
}
