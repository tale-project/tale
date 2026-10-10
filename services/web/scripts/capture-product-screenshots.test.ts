import { describe, expect, it, vi } from 'vitest';

import { PRODUCT_SCREENSHOTS } from '../app/content/product-screenshots';
import {
  captureProductScreenshots,
  productCaptureArgs,
} from './capture-product-screenshots';

describe('marketing screenshot orchestration', () => {
  it('derives its default source list from the product registry in all three languages', () => {
    const args = productCaptureArgs([]);
    expect(args.slice(0, 2)).toEqual(['--locales', 'en,de,fr']);
    const sources = args[args.indexOf('--only') + 1].split(',');
    expect(new Set(sources)).toEqual(
      new Set(Object.values(PRODUCT_SCREENSHOTS).map(({ source }) => source)),
    );
  });

  it('forwards state and config paths intact to capture before optimizing', async () => {
    const run = vi
      .fn<(_command: readonly string[]) => Promise<number>>()
      .mockResolvedValue(0);
    const flags = [
      '--',
      '--state-dir',
      '/private/capture state',
      '--config-dir',
      '/private/platform config',
      '--skip-seed',
    ];
    expect(await captureProductScreenshots(flags, run)).toBe(0);
    expect(run).toHaveBeenCalledTimes(2);
    expect(run.mock.calls[0][0].slice(-5)).toEqual(flags.slice(1));
    expect(run.mock.calls[0][0][1]).toMatch(
      /tests\/docs-screenshots\/capture\.ts$/,
    );
    expect(run.mock.calls[1][0].slice(1)).toEqual([
      'run',
      '--filter',
      '@tale/web',
      'optimize-images',
      '--product-screens',
    ]);
  });

  it('preserves a targeted refresh instead of appending defaults to its selection', () => {
    expect(
      productCaptureArgs(['--only', 'home-inbox', '--locales', 'fr']),
    ).toEqual(['--only', 'home-inbox', '--locales', 'fr']);
  });

  it('does not write derivatives after a failed capture', async () => {
    const run = vi
      .fn<(_command: readonly string[]) => Promise<number>>()
      .mockResolvedValue(7);
    expect(await captureProductScreenshots([], run)).toBe(7);
    expect(run).toHaveBeenCalledOnce();
  });

  it('lists without running the optimizer', async () => {
    const run = vi
      .fn<(_command: readonly string[]) => Promise<number>>()
      .mockResolvedValue(0);
    expect(await captureProductScreenshots(['--list'], run)).toBe(0);
    expect(run).toHaveBeenCalledOnce();
  });

  it('returns an optimizer failure', async () => {
    const run = vi
      .fn<(_command: readonly string[]) => Promise<number>>()
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(3);
    expect(await captureProductScreenshots([], run)).toBe(3);
  });
});
