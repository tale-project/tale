import type { ImapCredentials, ImapActionParams } from './types';

import {
  getString,
  getNumber,
  getBoolean,
} from '../../../../../lib/utils/type-guards';

/**
 * Get IMAP credentials from params or variables
 * Prioritizes params over variables
 * Supports both password-based and OAuth2 authentication
 */
export function getImapCredentials(
  params: ImapActionParams,
  variables: Record<string, unknown>,
): ImapCredentials {
  const host =
    params.host ||
    getString(variables, 'imapHost') ||
    getString(variables, 'host');
  const port =
    params.port ||
    getNumber(variables, 'imapPort') ||
    getNumber(variables, 'port') ||
    993;
  const secure =
    params.secure !== undefined
      ? params.secure
      : (getBoolean(variables, 'imapSecure') ??
        getBoolean(variables, 'secure') ??
        true);
  const username =
    params.username ||
    getString(variables, 'imapUsername') ||
    getString(variables, 'username') ||
    getString(variables, 'email');
  const password =
    params.password ||
    getString(variables, 'imapPassword') ||
    getString(variables, 'password');

  // Access token can be provided via parameters or non-secure variables
  // For secure values, pass them via step parameters so the engine decrypts them just-in-time
  const accessToken =
    params.accessToken ||
    getString(variables, 'imapAccessToken') ||
    getString(variables, 'accessToken');

  if (!host) {
    throw new Error(
      'IMAP host is required. Provide it in params.host or variables.imapHost',
    );
  }

  if (!username) {
    throw new Error(
      'IMAP username is required. Provide it in params.username or variables.imapUsername',
    );
  }

  // Either password or accessToken must be provided
  if (!password && !accessToken) {
    throw new Error(
      'IMAP authentication is required. Provide either password (params.password or variables.imapPassword) or accessToken (variables.imapAccessToken)',
    );
  }

  return {
    host,
    port,
    secure,
    username,
    password,
    accessToken,
  };
}
