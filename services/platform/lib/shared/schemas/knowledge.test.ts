import { describe, expect, it } from 'vitest';

import { knowledgeConnectionSchema, pgConnectionSchema } from './knowledge';

describe('pgConnectionSchema', () => {
  it('is the shape the per-org knowledge connection file validates against', () => {
    expect(knowledgeConnectionSchema).toBe(pgConnectionSchema);
  });

  it('applies port/sslmode defaults', () => {
    const r = pgConnectionSchema.safeParse({
      host: 'h',
      database: 'd',
      user: 'u',
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.port).toBe(5432);
      expect(r.data.sslmode).toBe('require');
    }
  });

  it('rejects an invalid sslmode', () => {
    const r = pgConnectionSchema.safeParse({
      host: 'h',
      database: 'd',
      user: 'u',
      sslmode: 'totally',
    });
    expect(r.success).toBe(false);
  });

  it('accepts hostnames, IPv4, and bracketed IPv6 hosts', () => {
    for (const host of [
      'db.internal',
      'pg-1.example.com',
      '10.0.0.5',
      '[::1]',
    ]) {
      const r = pgConnectionSchema.safeParse({
        host,
        database: 'd',
        user: 'u',
      });
      expect(r.success).toBe(true);
    }
  });

  it('rejects hosts carrying URL metacharacters (DSN-smuggle guard)', () => {
    for (const host of [
      'good.com/?sslmode=disable&x=1', // path + query smuggle
      'a.com,169.254.169.254', // multi-host
      'evil@host', // userinfo split
      'host name', // whitespace
      'h%2f', // percent escape
    ]) {
      const r = pgConnectionSchema.safeParse({
        host,
        database: 'd',
        user: 'u',
      });
      expect(r.success).toBe(false);
    }
  });
});
