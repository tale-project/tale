import { mkdir, mkdtemp, rename, rm, writeFile } from 'node:fs/promises';
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
    vi.restoreAllMocks();
  });

  /** A tree with one org + domain dir already present, then a live watcher
   * on it: the writes below exercise change reporting, not dir discovery. */
  async function start(
    coalesceMs: number,
    initialFile = false,
  ): Promise<ConfigChangeEvent[]> {
    dir = await mkdtemp(join(tmpdir(), 'tale-config-watcher-'));
    await mkdir(join(dir, 'acme', 'agents', '.history'), { recursive: true });
    if (initialFile) {
      await writeFile(
        join(dir, 'acme', 'agents', 'coder.yml'),
        'name: Before\n',
      );
    }
    watcher = createConfigWatcher(dir, { coalesceMs });
    const events: ConfigChangeEvent[] = [];
    watcher.onChange((event) => events.push(event));
    await watcher.ready;
    return events;
  }

  it('reports a config write as one event for the item', async () => {
    // A wide window coalesces the add and change into one invalidation.
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

  it('reports an atomic replacement and subsequent edits to the new inode', async () => {
    const events = await start(50, true);
    const file = join(dir, 'acme', 'agents', 'coder.yml');
    const temporary = join(dir, 'acme', 'agents', '.coder.yml.1.tmp');
    expect(events).toEqual([]);
    await writeFile(temporary, 'name: Replacement\n');
    await rename(temporary, file);
    await vi.waitFor(
      () =>
        expect(events).toContainEqual({
          type: 'agents',
          orgSlug: 'acme',
          slug: 'coder',
        }),
      { timeout: 10_000 },
    );
    events.length = 0;
    await writeFile(file, 'name: Replacement\ndescription: edited again\n');
    await vi.waitFor(
      () =>
        expect(events).toContainEqual({
          type: 'agents',
          orgSlug: 'acme',
          slug: 'coder',
        }),
      { timeout: 10_000 },
    );
    expect(events.every((event) => event.slug === 'coder')).toBe(true);
  });

  it('discovers a new org, domain and nested bundle written in one burst', async () => {
    const events = await start(50);
    const scripts = join(dir, 'second-org', 'skills', 'summarize', 'scripts');
    await mkdir(scripts, { recursive: true });
    await writeFile(join(scripts, 'run.py'), 'print("hello")\n');
    await vi.waitFor(
      () =>
        expect(events).toContainEqual({
          type: 'skills',
          orgSlug: 'second-org',
          slug: 'summarize',
        }),
      { timeout: 10_000 },
    );
    events.length = 0;
    await writeFile(join(scripts, 'run.py'), 'print("updated")\n');
    await vi.waitFor(
      () =>
        expect(events).toContainEqual({
          type: 'skills',
          orgSlug: 'second-org',
          slug: 'summarize',
        }),
      { timeout: 10_000 },
    );
    expect(events.every((event) => event.orgSlug === 'second-org')).toBe(true);
  });

  it('reports deletion and watches a recreated domain', async () => {
    const events = await start(50, true);
    const agents = join(dir, 'acme', 'agents');
    await rm(agents, { recursive: true });
    await vi.waitFor(
      () => expect(events).toContainEqual({ type: 'agents', orgSlug: 'acme' }),
      { timeout: 10_000 },
    );
    events.length = 0;
    await mkdir(agents);
    await writeFile(join(agents, 'helper.yml'), 'name: Helper\n');
    await vi.waitFor(
      () =>
        expect(events).toContainEqual({
          type: 'agents',
          orgSlug: 'acme',
          slug: 'helper',
        }),
      { timeout: 10_000 },
    );
  });

  it('continues reporting after a subscriber throws', async () => {
    const events = await start(50);
    const failedSubscriber = vi.fn(() => {
      throw new Error('subscriber failed');
    });
    const healthySubscriber = vi.fn();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    watcher?.onChange(failedSubscriber);
    watcher?.onChange(healthySubscriber);
    await writeFile(join(dir, 'acme', 'agents', 'coder.yml'), 'name: Coder\n');
    await vi.waitFor(
      () =>
        expect(healthySubscriber).toHaveBeenCalledWith({
          type: 'agents',
          orgSlug: 'acme',
          slug: 'coder',
        }),
      { timeout: 10_000 },
    );
    expect(failedSubscriber).toHaveBeenCalled();
    expect(events.some((event) => event.slug === 'coder')).toBe(true);
    expect(console.warn).toHaveBeenCalledWith(
      '[config-watcher] onChange callback failed',
      expect.any(Error),
    );
  });

  it('can close during its initial scan, and close again', async () => {
    dir = await mkdtemp(join(tmpdir(), 'tale-config-watcher-'));
    await mkdir(join(dir, 'acme', 'agents'), { recursive: true });
    watcher = createConfigWatcher(dir);
    const onChange = vi.fn();
    watcher.onChange(onChange);
    await watcher.close();
    await watcher.close();
    await writeFile(join(dir, 'acme', 'agents', 'coder.yml'), 'name: Coder\n');
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(onChange).not.toHaveBeenCalled();
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
