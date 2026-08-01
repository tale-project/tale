/**
 * The shipped model catalogs are valid, and every capability the app can
 * resolve has a model declaring it.
 *
 * This walks every `configs/platform/system/models/<provider>/models.yml` and
 * proves what the resolvers rely on: each file satisfies the catalog schema,
 * every entry's `provider` matches its directory, and — the part that bites —
 * each capability tag a resolver searches for is declared by at least one
 * entry.
 *
 * That last check exists because it was missing: audio transcription shipped
 * with a complete pipeline (compress → chunk → Whisper → ledger), a settings
 * capability label, and a resolver looking for a `transcription`-tagged
 * entry — while NO shipped catalog declared one. Every upload failed
 * `NO_TRANSCRIPTION_MODEL` on a stock install, and nothing in the suite
 * noticed, because a resolver that can never resolve still type-checks and
 * its own unit tests pass against a mocked catalog.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { parseYaml } from '../config/yaml';
import { modelCatalogFileSchema } from './providers';

const MODELS_DIR = path.join(
  path.dirname(new URL(import.meta.url).pathname),
  '../../../../../configs/platform/system/models',
);

/**
 * Capability tags a resolver looks up, and what breaks when none is declared.
 * A tag here without a shipped entry is a feature that cannot work on a stock
 * install — add the model, or drop the resolver.
 */
const RESOLVED_CAPABILITIES: Array<{ tag: string; resolver: string }> = [
  { tag: 'chat', resolver: 'the composer model listing' },
  { tag: 'embedding', resolver: 'knowledge indexing (one-click setup)' },
  { tag: 'text-to-speech', resolver: 'resolve_tts_model (read replies aloud)' },
  {
    tag: 'transcription',
    resolver: 'resolve_transcription_model (dictation + audio attachments)',
  },
];

function providerDirs(): string[] {
  return readdirSync(MODELS_DIR)
    .filter((name) => statSync(path.join(MODELS_DIR, name)).isDirectory())
    .sort();
}

function catalogOf(provider: string) {
  const file = path.join(MODELS_DIR, provider, 'models.yml');
  // These files are sequence-rooted, which the default mapping-only parse
  // rejects — the loader passes the same flag.
  const parsed = parseYaml(readFileSync(file, 'utf8'), {
    allowArrayRoot: true,
  });
  if (!parsed.ok) throw new Error(`${file}: ${parsed.error}`);
  return modelCatalogFileSchema.parse(parsed.data);
}

const ALL_ENTRIES = providerDirs().flatMap((provider) =>
  catalogOf(provider).map((entry) => ({ provider, entry })),
);

describe('shipped model catalogs', () => {
  it('ships at least one catalog', () => {
    // A glob that silently matched nothing would make every check below pass.
    expect(providerDirs().length).toBeGreaterThan(0);
    expect(ALL_ENTRIES.length).toBeGreaterThan(0);
  });

  it.each(providerDirs())('%s/models.yml satisfies the schema', (provider) => {
    expect(() => catalogOf(provider)).not.toThrow();
  });

  it.each(providerDirs())(
    '%s entries claim the provider whose directory they sit in',
    (provider) => {
      // A mismatched `provider` makes an entry unreachable: resolvers walk the
      // org's providers and read each one's own catalog.
      for (const entry of catalogOf(provider)) {
        expect(entry.provider).toBe(provider);
      }
    },
  );

  it.each(RESOLVED_CAPABILITIES)(
    'declares a $tag model, without which $resolver cannot resolve',
    ({ tag }) => {
      const declaring = ALL_ENTRIES.filter(({ entry }) =>
        entry.tags.includes(tag),
      );
      expect(
        declaring.map(({ provider, entry }) => `${provider}:${entry.id}`),
      ).not.toEqual([]);
    },
  );

  it('gives a transcription model to every provider that can serve one', () => {
    // Transcription is an OpenAI-wire capability: `resolveTranscriptionModel`
    // skips non-`openai` apiFormat connectors outright, so a transcription tag
    // on one of those would be dead weight rather than a working option.
    const transcribers = ALL_ENTRIES.filter(({ entry }) =>
      entry.tags.includes('transcription'),
    ).map(({ provider }) => provider);
    expect(transcribers).toContain('openai');
    expect(transcribers).toContain('openrouter');
  });

  it('keeps transcription entries free of per-token pricing', () => {
    // Transcription is billed per audio minute. A per-token price here would
    // be read as a token cost by the usage ledger and quietly misreport spend.
    for (const { entry } of ALL_ENTRIES) {
      if (!entry.tags.includes('transcription')) continue;
      expect(entry.pricing).toBeUndefined();
    }
  });
});
