/**
 * Core SMTP connection test logic (business rules only).
 * Low-level network I/O is provided via the verifySmtpConnection dependency.
 */

import type {
  TestConnectionArgs,
  TestConnectionDeps,
  SingleConnectionResult,
} from './test_connection_types';

import { createDebugLog } from '../../lib/debug_log';

const debugLog = createDebugLog('DEBUG_EMAIL', '[Email]');

export async function testSmtpConnectionLogic(
  args: TestConnectionArgs,
  deps: TestConnectionDeps,
): Promise<SingleConnectionResult> {
  const startTime = Date.now();
  const { smtpConfig } = args;

  try {
    debugLog(
      `Testing SMTP connection to ${smtpConfig.host}:${smtpConfig.port}...`,
    );

    let auth: Record<string, unknown> | undefined;
    if (args.authMethod === 'password' && args.passwordAuth) {
      auth = {
        user: args.passwordAuth.user,
        pass: args.passwordAuth.pass,
      };
    } else if (args.authMethod === 'oauth2' && args.oauth2Auth) {
      auth = {
        type: 'OAuth2',
        user: args.oauth2Auth.user,
        accessToken: args.oauth2Auth.accessToken,
      };
    } else {
      const error = 'Invalid authentication configuration';
      console.error(`SMTP test failed: ${error}`);
      return {
        success: false,
        latencyMs: Date.now() - startTime,
        error,
      };
    }

    await deps.verifySmtpConnection({ smtpConfig, auth });

    const latencyMs = Date.now() - startTime;
    debugLog(
      `\x1b[32mSMTP connection successful (\x1b[1m${latencyMs}\x1b[0mms)`,
    );

    return {
      success: true,
      latencyMs,
    };
  } catch (error) {
    let errorMessage =
      error instanceof Error ? error.message : 'Unknown SMTP connection error';

    // Detect Microsoft security defaults blocking basic auth
    if (
      errorMessage.includes('535 5.7.139') ||
      errorMessage.includes('security defaults policy') ||
      errorMessage.includes('Authentication unsuccessful, user is locked')
    ) {
      errorMessage =
        'Microsoft 365 security policy blocks password authentication. ' +
        'Please use OAuth2 authentication instead, or ask your administrator to enable basic authentication ' +
        '(not recommended for security reasons). Original error: ' +
        errorMessage;
    }

    console.error(`\x1b[31mSMTP connection failed: ${errorMessage}\x1b[0m`, {
      error,
    });

    return {
      success: false,
      latencyMs: Date.now() - startTime,
      error: errorMessage,
    };
  }
}
