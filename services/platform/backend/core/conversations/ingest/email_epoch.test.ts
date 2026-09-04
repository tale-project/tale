/**
 * One instant-reading concept for the whole ingest lane. Gmail hands back
 * `internalDate` (epoch ms as a STRING) when a message carries no `Date`
 * header; a message may also carry no readable date at all. Neither may ever
 * become a NaN stamp — the ingest shim validates stamps as numbers, so one NaN
 * rejects the write and wedges the mailbox pass behind it.
 */

import { describe, expect, it } from 'vitest';

import { byEmailDateAscending, emailEpochMs, emailStamps } from './email_epoch';

describe('emailEpochMs', () => {
  it('reads an RFC/ISO Date header', () => {
    expect(emailEpochMs('2026-07-01T09:00:00.000Z')).toBe(
      Date.UTC(2026, 6, 1, 9),
    );
  });

  it("reads Gmail's internalDate epoch-ms string when there is no Date header", () => {
    expect(emailEpochMs('1751360400000')).toBe(1751360400000);
  });

  it('accepts a numeric instant and refuses a non-finite one', () => {
    expect(emailEpochMs(1751360400000)).toBe(1751360400000);
    expect(emailEpochMs(Number.NaN)).toBeNull();
  });

  it('answers null for an absent, empty, or unreadable date', () => {
    expect(emailEpochMs(undefined)).toBeNull();
    expect(emailEpochMs('')).toBeNull();
    expect(emailEpochMs('   ')).toBeNull();
    expect(emailEpochMs('not a date')).toBeNull();
  });
});

describe('emailStamps', () => {
  it('stamps sentAt and deliveredAt for a delivered message with a date', () => {
    expect(emailStamps('1751360400000', true)).toEqual({
      sentAt: 1751360400000,
      deliveredAt: 1751360400000,
    });
  });

  it('stamps only sentAt for a message that is not delivered', () => {
    expect(emailStamps('2026-07-01T09:00:00.000Z', false)).toEqual({
      sentAt: Date.UTC(2026, 6, 1, 9),
    });
  });

  it('carries NO stamp — never NaN — when the date is unreadable', () => {
    const stamps = emailStamps('', true);
    expect(stamps).toEqual({});
    expect('sentAt' in stamps).toBe(false);
    expect('deliveredAt' in stamps).toBe(false);
  });
});

describe('byEmailDateAscending', () => {
  it('orders oldest first across ISO and epoch-string dates, undated first', () => {
    const emails = [
      { messageId: 'c', date: '2026-07-03T00:00:00.000Z' },
      { messageId: 'b', date: String(Date.UTC(2026, 6, 2)) },
      { messageId: 'undated', date: '' },
      { messageId: 'a', date: '2026-07-01T00:00:00.000Z' },
    ];
    expect(
      [...emails].sort(byEmailDateAscending).map((email) => email.messageId),
    ).toEqual(['undated', 'a', 'b', 'c']);
  });
});
