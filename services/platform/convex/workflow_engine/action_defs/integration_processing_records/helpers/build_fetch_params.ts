/**
 * Resume-point injection: merge the stored sync state (watermark/cursor) into
 * the fetch parameters sent to the integration operation.
 *
 * Watermark injection uses inclusive (`>=`) semantics on the remote side —
 * boundary records get re-fetched and are absorbed by the dedupe rows.
 */

import type { IntegrationSyncState } from '../../../../workflows/processing_records/integration_sync_state';
import type { IncrementalConfig, TimestampFormat } from './types';

/**
 * Normalize a timestamp-ish value (ISO/date string, epoch seconds or epoch
 * ms number) to epoch milliseconds. Numbers below 1e12 are treated as epoch
 * seconds — epoch ms passed 1e12 in 2001, epoch s only reaches it in ~33658.
 */
export function normalizeTimestampToMs(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value < 1e12 ? Math.round(value * 1000) : Math.round(value);
  }
  if (typeof value === 'string' && value.trim() !== '') {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) {
      return normalizeTimestampToMs(numeric);
    }
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? null : parsed;
  }
  return null;
}

export function formatWatermark(
  watermark: string | number,
  format: TimestampFormat,
): string | number {
  const ms = normalizeTimestampToMs(watermark);
  if (ms === null) {
    throw new Error(
      `Cannot format stored watermark "${watermark}" as a timestamp`,
    );
  }
  switch (format) {
    case 'iso':
      return new Date(ms).toISOString();
    case 'epoch_ms':
      return ms;
    case 'epoch_s':
      return Math.floor(ms / 1000);
    case 'date':
      return new Date(ms).toISOString().slice(0, 10);
    default:
      throw new Error(`Unsupported timestampFormat "${String(format)}"`);
  }
}

export interface BuildFetchParamsArgs {
  baseParams?: Record<string, unknown>;
  incrementalConfig?: IncrementalConfig;
  syncState: IntegrationSyncState | null;
  /**
   * cursor_based page loop: the cursor for the page being fetched. `null`
   * means "fetch from the beginning" even when a cursor is stored.
   */
  cursorOverride?: string | null;
}

export function buildFetchParams(
  args: BuildFetchParamsArgs,
): Record<string, unknown> {
  const params: Record<string, unknown> = { ...args.baseParams };
  const config = args.incrementalConfig;
  if (!config || config.strategy === 'full_scan') {
    return params;
  }

  const { resumeParamKey } = config;
  if (!resumeParamKey) {
    throw new Error(
      `incrementalConfig.resumeParamKey is required for the "${config.strategy}" strategy`,
    );
  }

  // Stored state from a different strategy is never injected.
  const syncState =
    args.syncState?.strategy === config.strategy ? args.syncState : null;

  switch (config.strategy) {
    case 'timestamp_based': {
      const watermark = syncState?.watermark;
      if (watermark !== undefined) {
        params[resumeParamKey] = formatWatermark(
          watermark,
          config.timestampFormat ?? 'iso',
        );
      }
      return params;
    }
    case 'id_based': {
      const watermark = syncState?.watermark;
      if (watermark !== undefined) {
        params[resumeParamKey] = watermark;
      }
      return params;
    }
    case 'cursor_based': {
      const cursor =
        args.cursorOverride !== undefined
          ? args.cursorOverride
          : (syncState?.cursor ?? null);
      if (cursor !== null && cursor !== '') {
        params[resumeParamKey] = cursor;
      }
      return params;
    }
    default:
      throw new Error(
        `Unsupported incremental strategy "${String(config.strategy)}"`,
      );
  }
}
