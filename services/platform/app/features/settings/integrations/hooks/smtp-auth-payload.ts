/**
 * Decide the SMTP-auth mutation patch for an imap_smtp integration from the
 * credentials form's "Use a separate SMTP provider" toggle and any entered
 * credentials. Kept pure (no React, no Convex) so the set / clear / no-op
 * branches are unit-testable without rendering the manage dialog.
 *
 * - toggle ON, a field entered   → set smtpAuth (username falls back to stored)
 * - toggle ON, nothing entered    → {} (leave the stored smtpAuth untouched)
 * - toggle OFF, creds were stored → clear them (revert to the mailbox login)
 * - toggle OFF, nothing stored    → {} (no-op)
 */
export interface SmtpAuthPatch {
  smtpAuth?: { username: string; password: string };
  clearSmtpAuth?: true;
}

export function buildSmtpAuthPatch(input: {
  smtpSeparate: boolean;
  smtpUsername: string | undefined;
  smtpPassword: string | undefined;
  storedUsername: string | undefined;
  hasStoredSmtpAuth: boolean;
}): SmtpAuthPatch {
  if (input.smtpSeparate) {
    const username = input.smtpUsername?.trim();
    const password = input.smtpPassword?.trim();
    if (username || password) {
      return {
        smtpAuth: {
          username: username || input.storedUsername || '',
          password: password || '',
        },
      };
    }
    return {};
  }
  return input.hasStoredSmtpAuth ? { clearSmtpAuth: true } : {};
}
