import { describe, expect, it } from 'vitest';

import {
  buildFetchParams,
  formatWatermark,
  normalizeTimestampToMs,
} from './build_fetch_params';
import type { IncrementalConfig } from './types';

const WATERMARK_MS = Date.UTC(2026, 5, 1, 12, 0, 0); // 2026-06-01T12:00:00.000Z

describe('normalizeTimestampToMs', () => {
  it('parses ISO strings', () => {
    expect(normalizeTimestampToMs('2026-06-01T12:00:00.000Z')).toBe(
      WATERMARK_MS,
    );
  });

  it('treats large numbers as epoch ms and small numbers as epoch seconds', () => {
    expect(normalizeTimestampToMs(WATERMARK_MS)).toBe(WATERMARK_MS);
    expect(normalizeTimestampToMs(WATERMARK_MS / 1000)).toBe(WATERMARK_MS);
  });

  it('parses numeric strings as epochs', () => {
    expect(normalizeTimestampToMs(String(WATERMARK_MS))).toBe(WATERMARK_MS);
  });

  it('returns null for garbage', () => {
    expect(normalizeTimestampToMs('not a date')).toBeNull();
    expect(normalizeTimestampToMs(undefined)).toBeNull();
    expect(normalizeTimestampToMs(null)).toBeNull();
    expect(normalizeTimestampToMs('')).toBeNull();
    expect(normalizeTimestampToMs(Number.NaN)).toBeNull();
  });
});

describe('formatWatermark', () => {
  it('formats every timestamp format', () => {
    expect(formatWatermark(WATERMARK_MS, 'iso')).toBe(
      '2026-06-01T12:00:00.000Z',
    );
    expect(formatWatermark(WATERMARK_MS, 'epoch_ms')).toBe(WATERMARK_MS);
    expect(formatWatermark(WATERMARK_MS, 'epoch_s')).toBe(WATERMARK_MS / 1000);
    expect(formatWatermark(WATERMARK_MS, 'date')).toBe('2026-06-01');
  });

  it('throws on an unparseable watermark', () => {
    expect(() => formatWatermark('garbage', 'iso')).toThrow(
      /Cannot format stored watermark/,
    );
  });
});

describe('buildFetchParams', () => {
  it('returns base params unchanged without incremental config', () => {
    expect(
      buildFetchParams({ baseParams: { limit: 10 }, syncState: null }),
    ).toEqual({ limit: 10 });
  });

  it('returns base params unchanged for full_scan', () => {
    expect(
      buildFetchParams({
        baseParams: { limit: 10 },
        incrementalConfig: { strategy: 'full_scan' },
        syncState: null,
      }),
    ).toEqual({ limit: 10 });
  });

  it('throws when resumeParamKey is missing for an incremental strategy', () => {
    for (const strategy of [
      'timestamp_based',
      'id_based',
      'cursor_based',
    ] as const) {
      expect(() =>
        buildFetchParams({
          incrementalConfig: { strategy },
          syncState: null,
        }),
      ).toThrow(/resumeParamKey is required/);
    }
  });

  describe('timestamp_based', () => {
    const config: IncrementalConfig = {
      strategy: 'timestamp_based',
      timestampField: 'modified_date',
      resumeParamKey: 'fromDate',
    };

    it('omits the resume param on first run (no sync state)', () => {
      expect(
        buildFetchParams({
          baseParams: { status: 'active' },
          incrementalConfig: config,
          syncState: null,
        }),
      ).toEqual({ status: 'active' });
    });

    it('injects the watermark as ISO by default', () => {
      expect(
        buildFetchParams({
          incrementalConfig: config,
          syncState: { strategy: 'timestamp_based', watermark: WATERMARK_MS },
        }),
      ).toEqual({ fromDate: '2026-06-01T12:00:00.000Z' });
    });

    it.each([
      ['iso', '2026-06-01T12:00:00.000Z'],
      ['epoch_ms', WATERMARK_MS],
      ['epoch_s', WATERMARK_MS / 1000],
      ['date', '2026-06-01'],
    ] as const)('injects the watermark formatted as %s', (format, expected) => {
      expect(
        buildFetchParams({
          incrementalConfig: { ...config, timestampFormat: format },
          syncState: { strategy: 'timestamp_based', watermark: WATERMARK_MS },
        }),
      ).toEqual({ fromDate: expected });
    });

    it('ignores sync state stored under a different strategy', () => {
      expect(
        buildFetchParams({
          incrementalConfig: config,
          syncState: { strategy: 'id_based', watermark: 42 },
        }),
      ).toEqual({});
    });
  });

  describe('id_based', () => {
    const config: IncrementalConfig = {
      strategy: 'id_based',
      resumeParamKey: 'since_id',
    };

    it('injects the stored max id as-is', () => {
      expect(
        buildFetchParams({
          incrementalConfig: config,
          syncState: { strategy: 'id_based', watermark: 1042 },
        }),
      ).toEqual({ since_id: 1042 });
    });

    it('omits the resume param without a watermark', () => {
      expect(
        buildFetchParams({
          incrementalConfig: config,
          syncState: { strategy: 'id_based' },
        }),
      ).toEqual({});
    });
  });

  describe('cursor_based', () => {
    const config: IncrementalConfig = {
      strategy: 'cursor_based',
      resumeParamKey: 'page_info',
      cursorPath: 'result.page_info.next',
    };

    it('injects the stored cursor', () => {
      expect(
        buildFetchParams({
          incrementalConfig: config,
          syncState: { strategy: 'cursor_based', cursor: 'abc' },
        }),
      ).toEqual({ page_info: 'abc' });
    });

    it('prefers the cursorOverride from the page loop', () => {
      expect(
        buildFetchParams({
          incrementalConfig: config,
          syncState: { strategy: 'cursor_based', cursor: 'abc' },
          cursorOverride: 'next-page',
        }),
      ).toEqual({ page_info: 'next-page' });
    });

    it('treats a null cursorOverride as fetch-from-scratch', () => {
      expect(
        buildFetchParams({
          incrementalConfig: config,
          syncState: { strategy: 'cursor_based', cursor: 'abc' },
          cursorOverride: null,
        }),
      ).toEqual({});
    });
  });
});
