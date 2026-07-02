import type { MigrationMeta } from '../../../framework/types';

/**
 * 0.2.89 / 03 — retarget the Claude Code agent's default model to Fable 5.
 *
 * The shipped default pin for the in-sandbox Claude Code agent moves from the
 * static `openrouter:anthropic/claude-opus-4.8` to the rolling
 * `openrouter:~anthropic/claude-fable-latest` alias (concrete
 * `openrouter:anthropic/claude-fable-5` second), so orgs keep tracking
 * Anthropic's most capable model automatically. Per org: append the two Fable
 * entries to `providers/openrouter.json` when absent (the rolling alias is
 * never auto-added by the weekly model sync — its `~anthropic` vendor prefix
 * is outside the curated set), then retarget every `agentKind: 'claude-code'`
 * agent whose `supportedModels` still equals the old shipped default.
 * Operator-edited pins are left untouched (the weekly sync's 3-way-merge
 * spirit). Fully reversible in place — `down` removes exactly the catalog
 * entries `up` writes and restores the old pin — so no fs snapshot is needed.
 */
export const meta: MigrationMeta = {
  id: '0.2.89/03_claude_code_fable_default',
  semver: '0.2.89',
  numericId: 3,
  slug: 'claude_code_fable_default',
  title: 'Default the Claude Code agent to Claude Fable 5 (rolling latest)',
  description:
    'For each org with an openrouter provider config, appends the ' +
    'anthropic/claude-fable-5 and ~anthropic/claude-fable-latest catalog ' +
    'entries when absent, then retargets every claude-code agent whose ' +
    'supportedModels still equals the old shipped default ' +
    '(openrouter:anthropic/claude-opus-4.8) to the new Fable default. ' +
    'Operator-edited pins and catalog entries are left untouched. down ' +
    'restores the old pin and removes only the exact entries up added.',
  kind: 'node',
  reversible: true,
  destructive: false,
  snapshot: 'none',
};
