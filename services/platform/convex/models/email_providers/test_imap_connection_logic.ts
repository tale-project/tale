/**
 * Core IMAP connection test logic (business rules only).
 * Low-level network I/O is provided via the verifyImapConnection dependency.
 */

import type {
  TestConnectionArgs,
  TestConnectionDeps,
  SingleConnectionResult,
  VerifyImapConnectionParams,
} from './test_connection_types';

import { createDebugLog } from '../../lib/debug_log';

const debugLog = createDebugLog('DEBUG_EMAIL', '[Email]');

export async function testImapConnectionLogic(
  args: TestConnectionArgs,
  deps: TestConnectionDeps,
): Promise<SingleConnectionResult> {
  const startTime = Date.now();
  const { imapConfig } = args;

  try {
    debugLog(
      `Testing IMAP connection to ${imapConfig.host}:${imapConfig.port}...`,
    );

    let auth: VerifyImapConnectionParams['auth'] | undefined;
    if (args.authMethod === 'password' && args.passwordAuth) {
      auth = {
        user: args.passwordAuth.user,
        pass: args.passwordAuth.pass,
      };
    } else if (args.authMethod === 'oauth2' && args.oauth2Auth) {
      auth = {
        user: args.oauth2Auth.user,
        accessToken: args.oauth2Auth.accessToken,
      };
    } else {
      const error = 'Invalid authentication configuration';
      console.error(`IMAP test failed: ${error}`);
      return {
        success: false,
        latencyMs: Date.now() - startTime,
        error,
      };
    }

    await deps.verifyImapConnection({ imapConfig, auth });

    const latencyMs = Date.now() - startTime;
    debugLog(
      `\x1b[32mIMAP connection successful (\x1b[1m${latencyMs}\x1b[0mms)`,
    );

    return {
      success: true,
      latencyMs,
    };
  } catch (error) {
    let errorMessage =
      error instanceof Error ? error.message : 'Unknown IMAP connection error';

    // Detect Microsoft security defaults blocking basic auth
    if (
      errorMessage.includes('AUTHENTICATE failed') ||
      errorMessage.includes('authenticationFailed')
    ) {
      // Check if this is likely a Microsoft/Outlook account
      if (
        imapConfig.host.includes('outlook') ||
        imapConfig.host.includes('office365')
      ) {
        errorMessage =
          'Microsoft 365 security policy blocks password authentication. ' +
          'Please use OAuth2 authentication instead, or ask your administrator to enable basic authentication ' +
          '(not recommended for security reasons). Original error: ' +
          errorMessage;
      }
    }

    console.error(`\x1b[31mIMAP connection failed: ${errorMessage}\x1b[0m`, {
      error,
    });

    return {
      success: false,
      latencyMs: Date.now() - startTime,
      error: errorMessage,
    };
  }
}
