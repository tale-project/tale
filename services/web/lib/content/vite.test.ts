import { readFile } from 'node:fs/promises';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { marketingContentImports } from './vite';

vi.mock('node:fs/promises', () => {
  const readSource = vi.fn();
  return { readFile: readSource, default: { readFile: readSource } };
});

const body =
  '## A concrete research project\n\nA body fetched only for this page.';
const source = `---
title: Research projects for teams and AI agents
description: Coordinate a research project with your team and AI agents, compare the source material, and review clear deliverables together.
slug: research
reviewed: '2026-10-03'
draft: false
---
${body}`;
const file = '/content/use-cases/en/research.md';

interface LoadContext {
  addWatchFile: (file: string) => void;
  emitFile: (asset: { type: 'asset'; name: string; source: string }) => string;
}
type Load = (
  this: LoadContext,
  id: string,
  options?: { ssr?: boolean },
) => Promise<string | null>;

function hooks(development = false) {
  const plugin = marketingContentImports();
  // The plugin uses bare hooks; the Vite union also permits object hooks.
  const configure = plugin.configResolved as unknown as (config: {
    command: 'serve' | 'build';
  }) => void;
  configure({ command: development ? 'serve' : 'build' });
  const context = {
    addWatchFile: vi.fn(),
    emitFile: vi.fn(() => 'body_asset'),
  };
  const load = (plugin.load as unknown as Load).bind(context);
  return { load, context };
}

beforeEach(() => vi.mocked(readFile).mockResolvedValue(source));

describe('marketing content build boundary', () => {
  it('keeps the metadata manifest free of Markdown bodies', async () => {
    const { load, context } = hooks();
    const module = await load(`${file}?marketing-meta`);
    expect(module).toContain('Research projects for teams and AI agents');
    expect(module).not.toContain('A body fetched only');
    expect(context.emitFile).not.toHaveBeenCalled();
  });

  it('emits a standalone text asset and only its URL in production client JavaScript', async () => {
    const { load, context } = hooks();
    expect(await load(`${file}?marketing-body`)).toBe(
      'export default import.meta.ROLLUP_FILE_URL_body_asset;',
    );
    expect(context.emitFile).toHaveBeenCalledWith({
      type: 'asset',
      name: 'use-cases-en-research.md',
      source: body,
    });
  });

  it('returns the body directly to SSR, which has no browser asset fetch', async () => {
    const { load, context } = hooks();
    expect(await load(`${file}?marketing-body`, { ssr: true })).toBe(
      `export default ${JSON.stringify(body)};`,
    );
    expect(context.emitFile).not.toHaveBeenCalled();
  });

  it('omits unpublished bodies from production outputs while permitting local preview', async () => {
    vi.mocked(readFile).mockResolvedValue(
      source.replace('draft: false', 'draft: true'),
    );
    const production = hooks();
    expect(await production.load(`${file}?marketing-body`)).toBe(
      'export default "";',
    );
    expect(await production.load(`${file}?marketing-body`, { ssr: true })).toBe(
      'export default "";',
    );
    expect(production.context.emitFile).not.toHaveBeenCalled();
    expect(await hooks(true).load(`${file}?marketing-body`)).toContain(
      'A body fetched only',
    );
  });
});
