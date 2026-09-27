/**
 * One instant-reading concept for the whole ingest lane. Gmail hands back
 * `internalDate` (epoch ms as a STRING) when a message carries no `Date`
 * header; a message may also carry no readable date at all. Neither may ever
 * become a NaN or out-of-range stamp — the ingest shim holds stamps to
 * `epochMsSchema`, so one such stamp rejects the write and wedges the mailbox
 * pass behind it.
 */

import { describe, expect, it } from 'vitest';

import {
  byEmailDateAscending,
  emailEpochMs,
  emailStamps,
  tipOfEmails,
} from './email_epoch';

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

  it('answers null for an instant the ingest shim would refuse', () => {
    // A far-future internalDate: a safe integer no Date can hold.
    expect(emailEpochMs('9000000000000000')).toBeNull();
    expect(emailEpochMs(9e15)).toBeNull();
    expect(emailEpochMs('Mon, 01 Jan 1900 00:00:00 +0000')).toBeNull();
    expect(emailEpochMs(1751360400000.5)).toBeNull();
  });

  it("keeps the epoch itself, the IMAP reader's stamp for a header it cannot parse", () => {
    expect(emailEpochMs('1970-01-01T00:00:00.000Z')).toBe(0);
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

  it('carries NO stamp for a date no Date can hold', () => {
    expect(emailStamps('9000000000000000', true)).toEqual({});
  });
});

describe('tipOfEmails', () => {
  it('never advances the watermark to an instant the shim would refuse', () => {
    expect(
      tipOfEmails([
        { date: '2026-07-01T09:00:00.000Z' },
        { date: '9000000000000000' },
      ]),
    ).toBe(Date.UTC(2026, 6, 1, 9));
    expect(tipOfEmails([{ date: '9000000000000000' }])).toBeNull();
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
