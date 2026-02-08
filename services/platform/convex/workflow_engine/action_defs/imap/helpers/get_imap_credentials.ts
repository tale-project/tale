import type { ImapCredentials, ImapActionParams } from './types';

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
    params.host || (variables.imapHost as string) || (variables.host as string);
  const port =
    params.port ||
    (variables.imapPort as number) ||
    (variables.port as number) ||
    993;
  const secure =
    params.secure !== undefined
      ? params.secure
      : (variables.imapSecure as boolean) !== undefined
        ? (variables.imapSecure as boolean)
        : (variables.secure as boolean) !== undefined
          ? (variables.secure as boolean)
          : true;
  const username =
    params.username ||
    (variables.imapUsername as string) ||
    (variables.username as string) ||
    (variables.email as string);
  const password =
    params.password ||
    (variables.imapPassword as string) ||
    (variables.password as string);

  // Access token can be provided via parameters or non-secure variables
  // For secure values, pass them via step parameters so the engine decrypts them just-in-time
  const accessToken =
    params.accessToken ||
    (variables.imapAccessToken as string) ||
    (variables.accessToken as string);

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

