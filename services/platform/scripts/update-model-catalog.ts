/**
 * Weekly model-catalog updater (run by `.github/workflows/update-models.yml`).
 *
 * Fetches OpenRouter's public catalog, then for each shipped provider config in
 * `builtin-configs/providers/*.json` applies the pure sync engine
 * (`lib/shared/model-sync.ts`): refresh capability fields, add newly-released
 * flagship frontier models, and hide superseded older versions. The result is
 * re-validated against `providerJsonSchema` and written back.
 *
 * It then regenerates the shipped-model TABLE in the docs catalogue
 * (`docs/<locale>/platform/models.md`) between the `<!-- MODELS_TABLE:START -->`
 * and `<!-- MODELS_TABLE:END -->` markers, so the published catalogue can never
 * drift from the config. The workflow opens a PR with whatever changed.
 *
 * Usage:
 *   bun run scripts/update-model-catalog.ts             # sync + regenerate docs
 *   bun run scripts/update-model-catalog.ts --dry-run   # report only, write nothing
 *   bun run scripts/update-model-catalog.ts --docs-only # rebuild docs table from
 *                                                       # on-disk config (no fetch)
 *
 * Env:
 *   MODEL_SYNC_BODY_PATH  if set, a markdown change summary is written there
 *                         (the workflow feeds it into the PR body).
 */

import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { normalizeCatalogPayload } from '../convex/lib/agent_response/model_capabilities/normalize';
import {
  type ModelSyncChange,
  syncProviderModels,
} from '../lib/shared/model-sync';
import {
  type ProviderJson,
  providerJsonSchema,
} from '../lib/shared/schemas/providers';

const OPENROUTER_CATALOG_URL = 'https://openrouter.ai/api/v1/models';
const MAX_ATTEMPTS = 4;
const REPO_ROOT = path.resolve(import.meta.dir, '../../..');
const PROVIDERS_DIR = path.join(REPO_ROOT, 'builtin-configs/providers');

/** The provider config the docs catalogue table is generated from. */
const DOCS_SOURCE_FILE = 'openrouter.json';

type Locale = 'en' | 'de' | 'fr';

/** Locale docs pages that carry the generated catalogue table. */
const DOCS_TARGETS: readonly { locale: Locale; file: string }[] = [
  { locale: 'en', file: path.join(REPO_ROOT, 'docs/en/platform/models.md') },
  { locale: 'de', file: path.join(REPO_ROOT, 'docs/de/platform/models.md') },
  { locale: 'fr', file: path.join(REPO_ROOT, 'docs/fr/platform/models.md') },
];

const TABLE_START = '<!-- MODELS_TABLE:START -->';
const TABLE_END = '<!-- MODELS_TABLE:END -->';

const TABLE_HEADERS: Record<Locale, readonly string[]> = {
  en: [
    'Provider',
    'Model',
    'Capabilities',
    'Context',
    'Input ($/M)',
    'Output ($/M)',
  ],
  de: [
    'Anbieter',
    'Modell',
    'Fähigkeiten',
    'Kontext',
    'Eingabe ($/M)',
    'Ausgabe ($/M)',
  ],
  fr: [
    'Fournisseur',
    'Modèle',
    'Capacités',
    'Contexte',
    'Entrée ($/M)',
    'Sortie ($/M)',
  ],
};

/** Invisible English maintenance note emitted above the table in every locale
 *  (an HTML comment, so readers never see it — it's a hint for contributors). */
const GENERATED_COMMENT = `<!-- Auto-generated from builtin-configs/providers/${DOCS_SOURCE_FILE} by the weekly model-catalog sync. Do not edit by hand. -->`;

/** Pretty vendor labels for the `vendor/` id prefix; falls back to the prefix. */
const VENDOR_LABELS: Record<string, string> = {
  anthropic: 'Anthropic',
  // OpenRouter's rolling `~vendor/…-latest` aliases carry a `~` on the vendor.
  '~anthropic': 'Anthropic',
  openai: 'OpenAI',
  google: 'Google',
  deepseek: 'DeepSeek',
  moonshotai: 'Moonshot AI',
  minimax: 'MiniMax',
  qwen: 'Qwen',
  'x-ai': 'xAI',
  mistralai: 'Mistral',
  'z-ai': 'Z.AI',
  'meta-llama': 'Meta',
  nvidia: 'NVIDIA',
  xiaomi: 'Xiaomi',
  cohere: 'Cohere',
  microsoft: 'Microsoft',
  amazon: 'Amazon',
  perplexity: 'Perplexity',
  ai21: 'AI21',
  rekaai: 'Reka',
  liquid: 'Liquid',
  'black-forest-labs': 'Black Forest Labs',
};

type ModelDef = ProviderJson['models'][number];

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

async function fetchCatalog(): Promise<unknown> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const res = await fetch(OPENROUTER_CATALOG_URL, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(30_000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
      return await res.json();
    } catch (err) {
      lastErr = err;
      console.warn(
        `[update-model-catalog] fetch attempt ${attempt}/${MAX_ATTEMPTS} failed: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      if (attempt < MAX_ATTEMPTS) await sleep(2_000 * attempt);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

/** Render an untrusted catalog model id as safe inline code in the PR body:
 *  strip backticks + control chars so it can't break out of the code span or
 *  inject markdown/HTML into the generated PR description. */
function safeId(modelId: string): string {
  // oxlint-disable-next-line no-control-regex -- deliberately strip control chars from untrusted ids
  const clean = modelId.replace(/[`\x00-\x1f\x7f]/g, '').slice(0, 200);
  return `\`${clean}\``;
}

const CHANGE_SECTIONS: readonly [ModelSyncChange['kind'], string][] = [
  ['added', 'Added'],
  ['hidden', 'Hidden'],
  ['updated', 'Updated'],
];

function summarize(provider: string, changes: ModelSyncChange[]): string {
  const lines: string[] = [];
  for (const [kind, label] of CHANGE_SECTIONS) {
    const ids = changes
      .filter((c) => c.kind === kind)
      .map((c) => safeId(c.modelId));
    if (ids.length) {
      lines.push(`  - **${label}** (${ids.length}): ${ids.join(', ')}`);
    }
  }
  return lines.length ? `- \`${provider}\`\n${lines.join('\n')}` : '';
}

/** Deterministic ASCII string compare (no Intl/locale dependence). */
function strcmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function vendorLabel(modelId: string): string {
  const slash = modelId.indexOf('/');
  const prefix = slash === -1 ? modelId : modelId.slice(0, slash);
  return VENDOR_LABELS[prefix] ?? prefix;
}

/** A readable context-window size: `1M`, `262K`, or `—`. */
function formatContext(n: number | undefined): string {
  if (n == null || n <= 0) return '—';
  if (n >= 1_000_000) return `${Math.round(n / 1_000_000)}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}K`;
  return String(n);
}

/** Cents-per-million → dollars-per-million, two decimals; `—` when absent. */
function formatPrice(cents: number | undefined): string {
  if (cents == null) return '—';
  return (cents / 100).toFixed(2);
}

/** Escape a cell so it can't break the Markdown table. */
function cell(value: string): string {
  return value.replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

/** Build the Markdown catalogue table for a locale from the visible models. */
function renderModelsTable(config: ProviderJson, locale: Locale): string {
  const visible = config.models
    .filter((m) => !m.hidden)
    .sort((a, b) => {
      const byVendor = strcmp(vendorLabel(a.id), vendorLabel(b.id));
      if (byVendor !== 0) return byVendor;
      const byQuality = (b.qualityScore ?? 0) - (a.qualityScore ?? 0);
      if (byQuality !== 0) return byQuality;
      return strcmp(a.displayName, b.displayName);
    });

  const headers = TABLE_HEADERS[locale];
  const rows = visible.map((m: ModelDef) => {
    const cols = [
      vendorLabel(m.id),
      m.displayName,
      m.tags.join(', '),
      formatContext(m.contextWindow),
      formatPrice(m.cost?.inputCentsPerMillion),
      formatPrice(m.cost?.outputCentsPerMillion),
    ];
    return `| ${cols.map(cell).join(' | ')} |`;
  });

  return [
    `| ${headers.join(' | ')} |`,
    `| ${headers.map(() => '---').join(' | ')} |`,
    ...rows,
  ].join('\n');
}

/** Splice the generated block between the table markers; null if no markers. */
function spliceTable(content: string, block: string): string | null {
  const start = content.indexOf(TABLE_START);
  const end = content.indexOf(TABLE_END);
  if (start === -1 || end === -1 || end < start) return null;
  const before = content.slice(0, start + TABLE_START.length);
  const after = content.slice(end);
  return `${before}\n\n${block}\n\n${after}`;
}

/** Regenerate the catalogue table in every locale docs page; returns the files
 *  whose content actually changed. */
async function writeDocsTables(
  config: ProviderJson,
  opts: { dryRun: boolean },
): Promise<string[]> {
  const changed: string[] = [];
  for (const { locale, file } of DOCS_TARGETS) {
    let content: string;
    try {
      content = await readFile(file, 'utf8');
    } catch {
      console.warn(`[update-model-catalog] docs: ${file} not found, skipping`);
      continue;
    }
    const block = `${GENERATED_COMMENT}\n\n${renderModelsTable(config, locale)}`;
    const next = spliceTable(content, block);
    if (next == null) {
      console.warn(
        `[update-model-catalog] docs: markers not found in ${file}, skipping`,
      );
      continue;
    }
    if (next === content) continue;
    changed.push(path.relative(REPO_ROOT, file));
    if (!opts.dryRun) await writeFile(file, next, 'utf8');
  }
  return changed;
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run');
  const docsOnly = process.argv.includes('--docs-only');

  const files = (await readdir(PROVIDERS_DIR)).filter(
    (f) => f.endsWith('.json') && !f.endsWith('.secrets.json'),
  );

  // The resolved (possibly synced) shape of each provider, used to rebuild the
  // docs table afterward so it always reflects what shipped.
  const resolved: Record<string, ProviderJson> = {};
  const summaries: string[] = [];
  let totalChanges = 0;

  if (docsOnly) {
    for (const file of files) {
      const raw = await readFile(path.join(PROVIDERS_DIR, file), 'utf8');
      const parsed = providerJsonSchema.safeParse(JSON.parse(raw));
      if (parsed.success) resolved[file] = parsed.data;
      else
        console.warn(
          `[update-model-catalog] skip ${file}: invalid (${parsed.error.issues[0]?.message})`,
        );
    }
  } else {
    const payload = await fetchCatalog();
    const facts = normalizeCatalogPayload(payload);
    console.info(
      `[update-model-catalog] fetched ${facts.length} catalog models`,
    );

    for (const file of files) {
      const full = path.join(PROVIDERS_DIR, file);
      const raw = await readFile(full, 'utf8');
      const parsed = providerJsonSchema.safeParse(JSON.parse(raw));
      if (!parsed.success) {
        console.warn(
          `[update-model-catalog] skip ${file}: invalid (${parsed.error.issues[0]?.message})`,
        );
        continue;
      }
      const config = parsed.data;
      resolved[file] = config;
      const { models, changes } = syncProviderModels({
        current: config.models,
        facts,
      });
      if (changes.length === 0) continue;

      const next = { ...config, models };
      const revalidated = providerJsonSchema.safeParse(next);
      if (!revalidated.success) {
        console.error(
          `[update-model-catalog] ${file}: synced config failed validation, skipping — ${revalidated.error.issues[0]?.message}`,
        );
        continue;
      }

      resolved[file] = next;
      totalChanges += changes.length;
      const summary = summarize(file, changes);
      if (summary) summaries.push(summary);
      console.info(
        `[update-model-catalog] ${file}: ${changes.length} change(s)`,
      );

      if (!dryRun) {
        await writeFile(full, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
      }
    }
  }

  // Regenerate the docs catalogue table from the (synced) source provider.
  const docsSource = resolved[DOCS_SOURCE_FILE];
  if (docsSource) {
    const docsChanged = await writeDocsTables(docsSource, { dryRun });
    if (docsChanged.length) {
      console.info(
        `[update-model-catalog] docs table ${
          dryRun ? 'would update' : 'updated'
        }: ${docsChanged.join(', ')}`,
      );
    }
  } else {
    console.warn(
      `[update-model-catalog] docs: ${DOCS_SOURCE_FILE} not found, skipping table`,
    );
  }

  if (docsOnly) {
    console.info('[update-model-catalog] docs-only: done');
    return;
  }

  const body =
    totalChanges === 0
      ? 'No model-catalog changes this run.'
      : [
          'Automated weekly model-catalog sync from OpenRouter.',
          '',
          'Updates capability fields (only where still at the shipped default),',
          'adds newly-released flagship frontier models, hides superseded older',
          'versions, and regenerates the docs catalogue table. **Review before',
          'merge** — quality scores and tiers are left for humans to set.',
          '',
          ...summaries,
        ].join('\n');

  const bodyPath = process.env.MODEL_SYNC_BODY_PATH;
  if (bodyPath) await writeFile(bodyPath, `${body}\n`, 'utf8');

  console.info(
    `[update-model-catalog] done: ${totalChanges} change(s) across ${summaries.length} provider(s)`,
  );
}

main().catch((err: unknown) => {
  console.error('[update-model-catalog] failed:', err);
  process.exit(1);
});
