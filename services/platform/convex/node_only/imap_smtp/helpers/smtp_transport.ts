/**
 * Shared nodemailer transport options for the SMTP send and connection-test
 * paths, so the two never drift — most importantly on TLS.
 *
 * On a STARTTLS / plaintext submission port (`secure: false`, e.g. 587 or 25)
 * we set `requireTLS` so nodemailer refuses to continue unless the server
 * upgrades the connection to TLS. Without it, opportunistic STARTTLS silently
 * falls back to cleartext when the server omits the `STARTTLS` advertisement
 * (or a network attacker strips it), leaking the credentials and message body
 * in the clear. Implicit TLS (`secure: true`, port 465) is already encrypted
 * from the first byte, so `requireTLS` is a no-op there.
 *
 * Certificate validation is left at nodemailer's default (`rejectUnauthorized`
 * on): this governs only *whether* TLS is required, not how the peer
 * certificate is checked.
 */

import type SMTPTransport from 'nodemailer/lib/smtp-transport';

import type { SmtpCredentials } from '../types';

export function buildSmtpTransportOptions(
  smtp: SmtpCredentials,
): SMTPTransport.Options {
  return {
    host: smtp.host,
    port: smtp.port,
    secure: smtp.secure,
    // Fail closed on the STARTTLS path — never downgrade to cleartext.
    requireTLS: !smtp.secure,
    auth: { user: smtp.user, pass: smtp.password },
  };
}
