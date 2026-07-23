'use node';

/**
 * 0.2.98 / 01 — retarget the Claude Code agent's default model to Fable 5.
 *
 * The shipped default pin for the in-sandbox Claude Code agent moves from the
 * static `openrouter:anthropic/claude-opus-4.8` to the rolling
 * `openrouter:~anthropic/claude-fable-latest` alias (auto-tracks Anthropic's
 * newest Fable-class model), the concrete `anthropic/claude-fable-5` second,
 * Opus 4.8 third (the Fable entries' `fallbackModelId` and the manual switch
 * when Fable usage is rationed) — appending both Fable catalog entries to the
 * org's `providers/openrouter.json` when absent so the new pin always
 * resolves (the rolling alias is never auto-added by the weekly model sync —
 * its `~anthropic` vendor prefix is outside the curated set).
 *
 * Conservative by design: an org without an `openrouter` provider file is
 * skipped entirely, an operator-edited `supportedModels` is left untouched
 * (the weekly sync's 3-way-merge spirit), and `down` removes only catalog
 * entries that still structurally equal the exact shapes `up` writes (a
 * cron-added or operator-edited Fable entry survives). Fully reversible in
 * place — idempotent per org in both directions — so no fs snapshot is
 * needed.
 */

import { structuralEqual } from '../../../../../lib/utils/structural-equal';
import {
  parseAgentJson,
  resolveAgentFilePathFromRelative,
  serializeAgentJson,
  walkAgentRelativePaths,
} from '../../../../legacy/frozen/agents_file_utils';
import {
  parseProviderJson,
  resolveProviderFilePath,
  serializeProviderJson,
} from '../../../../legacy/frozen/providers_file_utils';
import type { ModelDefinition } from '../../../../legacy/frozen/schemas_providers';
import {
  type BoundNodeHelpers,
  defineNodeMigration,
} from '../../../framework/define';
import type { MigrationOrg } from '../../../framework/types';

const PROVIDER_SLUG = 'openrouter';

/** The pre-0.2.89 shipped default pin for the Claude Code agent. */
export const OLD_SUPPORTED_MODELS: readonly string[] = [
  'openrouter:anthropic/claude-opus-4.8',
];

/** The new shipped default: rolling latest first, concrete Fable 5 second,
 * Opus 4.8 (the Fable entries' fallbackModelId) as the manual escape hatch
 * when Fable usage is rationed. */
export const NEW_SUPPORTED_MODELS: readonly string[] = [
  'openrouter:~anthropic/claude-fable-latest',
  'openrouter:anthropic/claude-fable-5',
  'openrouter:anthropic/claude-opus-4.8',
];

/**
 * Catalog entries appended to the org's openrouter provider config — keep in
 * sync with the same entries in `builtin-configs/providers/openrouter.json`.
 */
export const FABLE_CATALOG_MODELS: readonly ModelDefinition[] = [
  {
    id: 'anthropic/claude-fable-5',
    nativeModelId: 'claude-fable-5',
    displayName: 'Claude Fable 5',
    description: "Anthropic's most capable — Mythos-class reasoning and coding",
    tags: ['chat', 'vision'],
    reasoning: { knob: 'budgetTokens', minBudgetTokens: 1024 },
    promptCaching: { mode: 'explicit-breakpoints', maxBreakpoints: 4 },
    qualityScore: 0.98,
    fallbackModelId: 'anthropic/claude-opus-4.8',
    contextWindow: 1000000,
    maxOutputTokens: 128000,
    cost: { inputCentsPerMillion: 1000, outputCentsPerMillion: 5000 },
  },
  {
    id: '~anthropic/claude-fable-latest',
    nativeModelId: 'claude-fable-5',
    displayName: 'Claude Fable (latest)',
    description: "Rolling alias — always Anthropic's newest Fable-class model",
    tags: ['chat', 'vision'],
    reasoning: { knob: 'budgetTokens', minBudgetTokens: 1024 },
    promptCaching: { mode: 'explicit-breakpoints', maxBreakpoints: 4 },
    qualityScore: 0.98,
    fallbackModelId: 'anthropic/claude-opus-4.8',
    contextWindow: 1000000,
    maxOutputTokens: 128000,
    cost: { inputCentsPerMillion: 1000, outputCentsPerMillion: 5000 },
  },
];

/**
 * Rewrite `supportedModels` from `from` to `to` on every claude-code agent in
 * the org whose pin still structurally equals `from` — the shared engine of
 * `up` and `down` (they only swap direction). Files that fail to parse are
 * skipped loudly rather than failing the whole org.
 */
async function retargetClaudeCodeAgents(
  org: MigrationOrg,
  helpers: BoundNodeHelpers,
  from: readonly string[],
  to: readonly string[],
): Promise<void> {
  const relPaths = await walkAgentRelativePaths(org.slug);
  for (const rel of relPaths) {
    const filePath = resolveAgentFilePathFromRelative(org.slug, rel);
    const raw = await helpers.readFileSafe(filePath);
    if (raw === null) continue;
    let config;
    try {
      config = parseAgentJson(raw);
    } catch (err) {
      console.warn(
        `[${helpers.migrationId}] skipping unparseable agent file ${org.slug}/${rel}:`,
        err,
      );
      continue;
    }
    if (config.agentKind !== 'claude-code') continue;
    if (!structuralEqual(config.supportedModels, from)) continue;
    config.supportedModels = [...to];
    await helpers.atomicWrite(filePath, serializeAgentJson(config));
  }
}

export const migration = defineNodeMigration({
  title: 'Default the Claude Code agent to Claude Fable 5 (rolling latest)',
  description:
    'For each org with an openrouter provider config, appends the ' +
    'anthropic/claude-fable-5 and ~anthropic/claude-fable-latest catalog ' +
    'entries when absent, then retargets every claude-code agent whose ' +
    'supportedModels still equals the old shipped default ' +
    '(openrouter:anthropic/claude-opus-4.8) to the new Fable default. ' +
    'Operator-edited pins and catalog entries are left untouched. down ' +
    'restores the old pin and removes only the exact entries up added.',
  destructive: false,
  snapshot: 'none',
  formerIds: ['0.2.89/03_claude_code_fable_default'],
  subjects: { domains: ['agents', 'providers'] },

  async up(_ctx, org, helpers) {
    const providerPath = resolveProviderFilePath(org.slug, PROVIDER_SLUG);
    const providerRaw = await helpers.readFileSafe(providerPath);
    // No openrouter provider — the new pin could never resolve; leave the org
    // (including its agent pins) exactly as it is.
    if (providerRaw === null) return;

    const provider = parseProviderJson(providerRaw);
    const present = new Set(provider.models.map((model) => model.id));
    const missing = FABLE_CATALOG_MODELS.filter(
      (model) => !present.has(model.id),
    );
    if (missing.length > 0) {
      provider.models = [...provider.models, ...missing];
      await helpers.atomicWrite(providerPath, serializeProviderJson(provider));
    }

    await retargetClaudeCodeAgents(
      org,
      helpers,
      OLD_SUPPORTED_MODELS,
      NEW_SUPPORTED_MODELS,
    );
  },

  async down(_ctx, org, helpers) {
    await retargetClaudeCodeAgents(
      org,
      helpers,
      NEW_SUPPORTED_MODELS,
      OLD_SUPPORTED_MODELS,
    );

    const providerPath = resolveProviderFilePath(org.slug, PROVIDER_SLUG);
    const providerRaw = await helpers.readFileSafe(providerPath);
    if (providerRaw === null) return;

    const provider = parseProviderJson(providerRaw);
    // Remove only entries that still equal EXACTLY what `up` wrote — an
    // operator-edited or cron-added Fable entry (different shape) survives.
    const kept = provider.models.filter(
      (model) =>
        !FABLE_CATALOG_MODELS.some((added) => structuralEqual(model, added)),
    );
    if (kept.length !== provider.models.length) {
      provider.models = kept;
      await helpers.atomicWrite(providerPath, serializeProviderJson(provider));
    }
  },
});
