import { describe, it, expect } from 'vitest';

import type { SmtpCredentials } from '../types';
import { buildSmtpTransportOptions } from './smtp_transport';

const base: SmtpCredentials = {
  host: 'smtp.example.com',
  port: 587,
  secure: false,
  user: 'mailer',
  password: 's3cret',
};

describe('buildSmtpTransportOptions', () => {
  it('requires STARTTLS on a plaintext submission port (secure: false)', () => {
    const opts = buildSmtpTransportOptions({
      ...base,
      port: 587,
      secure: false,
    });

    expect(opts.secure).toBe(false);
    // Fail closed: nodemailer must not silently fall back to cleartext.
    expect(opts.requireTLS).toBe(true);
  });

  it('does not force STARTTLS on an implicit-TLS port (secure: true)', () => {
    const opts = buildSmtpTransportOptions({
      ...base,
      port: 465,
      secure: true,
    });

    expect(opts.secure).toBe(true);
    // Already encrypted from the first byte — requireTLS would be redundant.
    expect(opts.requireTLS).toBe(false);
  });

  it('passes host, port, and credentials through unchanged', () => {
    const opts = buildSmtpTransportOptions(base);

    expect(opts.host).toBe('smtp.example.com');
    expect(opts.port).toBe(587);
    expect(opts.auth).toEqual({ user: 'mailer', pass: 's3cret' });
  });
});
