import * as logger from "./logger";

export function getRequiredEnvVar(name: string): string {
  const value = process.env[name];
  if (!value) {
    logger.error(`Required environment variable ${name} is not set`);
    process.exit(1);
  }
  return value;
}
