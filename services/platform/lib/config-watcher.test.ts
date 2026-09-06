import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  type ConfigChangeEvent,
  type ConfigWatcher,
  createConfigWatcher,
  parseConfigChange,
} from './config-watcher';

const ROOT = '/data';

describe('parseConfigChange', () => {
  it('maps a flat file to its domain and slug', () => {
    expect(parseConfigChange(ROOT, `${ROOT}/acme/agents/coder.yml`)).toEqual({
      type: 'agents',
      orgSlug: 'acme',
      slug: 'coder',
    });
  });

  it('maps a secrets sidecar onto the item it belongs to', () => {
    expect(
      parseConfigChange(ROOT, `${ROOT}/acme/governance/pii.secrets.json`),
    ).toEqual({ type: 'governance', orgSlug: 'acme', slug: 'pii' });
  });

  it('maps a file deep inside a bundle to the bundle slug', () => {
    expect(
      parseConfigChange(ROOT, `${ROOT}/acme/skills/pdf/scripts/fill.py`),
    ).toEqual({ type: 'skills', orgSlug: 'acme', slug: 'pdf' });
  });

  it('reports a domain dir coming or going without a slug', () => {
    expect(parseConfigChange(ROOT, `${ROOT}/acme/branding`)).toEqual({
      type: 'branding',
      orgSlug: 'acme',
    });
  });

  it('ignores the org dir, the root and anything outside the tree', () => {
    expect(parseConfigChange(ROOT, `${ROOT}/acme`)).toBeNull();
    expect(parseConfigChange(ROOT, ROOT)).toBeNull();
    expect(parseConfigChange(ROOT, '/etc/passwd')).toBeNull();
    expect(parseConfigChange(ROOT, `${ROOT}/../other/agents/x.yml`)).toBeNull();
  });

  it('ignores dot entries: .history snapshots and atomic-write temp files', () => {
    expect(
      parseConfigChange(ROOT, `${ROOT}/acme/agents/.history/coder/1.yml`),
    ).toBeNull();
    expect(
      parseConfigChange(ROOT, `${ROOT}/acme/agents/.coder.yml.1712.ab12.tmp`),
    ).toBeNull();
  });

  it('refuses a malformed org slug or domain dir', () => {
    expect(parseConfigChange(ROOT, `${ROOT}/Acme/agents/coder.yml`)).toBeNull();
    expect(
      parseConfigChange(ROOT, `${ROOT}/acme/Agents Copy/coder.yml`),
    ).toBeNull();
  });
});

describe('createConfigWatcher', () => {
  let dir: string;
  let watcher: ConfigWatcher | undefined;

  afterEach(async () => {
    await watcher?.close();
    watcher = undefined;
    await rm(dir, { recursive: true, force: true });
  });

  /** A tree with one org + domain dir already present, then a live watcher
   * on it: the writes below exercise change reporting, not dir discovery. */
  async function start(coalesceMs: number): Promise<ConfigChangeEvent[]> {
    dir = await mkdtemp(join(tmpdir(), 'tale-config-watcher-'));
    await mkdir(join(dir, 'acme', 'agents', '.history'), { recursive: true });
    watcher = createConfigWatcher(dir, { coalesceMs });
    const events: ConfigChangeEvent[] = [];
    watcher.onChange((event) => events.push(event));
    await watcher.ready;
    return events;
  }

  it('reports a config write as one event for the item', async () => {
    // A wide window so every fs event of the write (add, change, the
    // atomic-write rename) provably lands inside it — one invalidation.
    const events = await start(500);
    const file = join(dir, 'acme', 'agents', 'coder.yml');
    await writeFile(file, 'name: Coder\n');
    await writeFile(file, 'name: Coder\ndescription: x\n');

    await vi.waitFor(
      () =>
        expect(events).toContainEqual({
          type: 'agents',
          orgSlug: 'acme',
          slug: 'coder',
        }),
      { timeout: 10_000 },
    );
    await new Promise((resolve) => setTimeout(resolve, 600));
    expect(events.filter((e) => e.slug === 'coder')).toHaveLength(1);
  });

  it('never emits for dot entries, and stops after close', async () => {
    const events = await start(50);
    await writeFile(join(dir, 'acme', 'agents', '.history', 'old.yml'), 'x\n');
    await writeFile(join(dir, 'acme', 'agents', '.coder.yml.1.tmp'), 'x\n');
    // A real file after the dot entries proves the watcher saw the burst.
    await writeFile(join(dir, 'acme', 'agents', 'coder.yml'), 'name: Coder\n');
    await vi.waitFor(
      () => expect(events.some((e) => e.slug === 'coder')).toBe(true),
      { timeout: 10_000 },
    );
    expect(events.every((e) => e.slug === 'coder')).toBe(true);

    await watcher?.close();
    watcher = undefined;
    const seen = events.length;
    await writeFile(join(dir, 'acme', 'agents', 'later.yml'), 'x\n');
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(events).toHaveLength(seen);
  });
});
