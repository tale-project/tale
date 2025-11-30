/**
 * Create sandbox context with controlled globals
 */

import type { SecretsApi } from './create_secrets_api';

export function createSandbox(
  logs: string[],
  secretsApi: SecretsApi,
): Record<string, unknown> {
  return {
    // Console logging
    console: {
      log: (...args: unknown[]) => {
        logs.push(args.map((a) => String(a)).join(' '));
      },
      error: (...args: unknown[]) => {
        logs.push('[ERROR] ' + args.map((a) => String(a)).join(' '));
      },
      warn: (...args: unknown[]) => {
        logs.push('[WARN] ' + args.map((a) => String(a)).join(' '));
      },
    },

    // Secrets API
    secrets: secretsApi,

    // Basic globals
    JSON,
    Object,
    Array,
    String,
    Number,
    Boolean,
    Date,
    Math,
    parseInt,
    parseFloat,
    isNaN,
    isFinite,
    encodeURIComponent,
    decodeURIComponent,
    encodeURI,
    decodeURI,
    Error,
    RegExp,
    Promise,
    setTimeout: undefined,
    setInterval: undefined,
  };
}
