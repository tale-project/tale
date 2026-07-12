/**
 * Validate a `sandbox` step's config (publish-time, pure — no I/O).
 *
 * A sandbox step stages inputs and runs EXACTLY ONE of:
 *  - `run.agent`  — ephemeral Claude-Code sandbox (needs a bounded budget)
 *  - `run.script` — deterministic frozen script (needs a language)
 *
 * Mirrors the Convex `sandboxNodeConfigValidator` (types/nodes.ts) but runs
 * against the free-form workflow-file `config`, so packs are checked before
 * they ever execute.
 */
import { getString, isRecord } from '../../../../../lib/utils/type-utils';
import type { ValidationResult } from '../types';

const SCRIPT_LANGUAGES = new Set(['python', 'node', 'bash']);
const INPUT_SOURCE_KEYS = ['fileId', 'folderId', 'folderPath', 'content'];

export function validateSandboxStep(
  config: Record<string, unknown>,
): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  const run = isRecord(config.run) ? config.run : undefined;
  if (!run) {
    errors.push('sandbox step requires a "run" object');
    return { valid: false, errors, warnings };
  }

  const hasAgent = typeof run.agent === 'string';
  const hasScript = typeof run.script === 'string';
  if (hasAgent === hasScript) {
    errors.push(
      'sandbox "run" must specify exactly one of "agent" (string) or "script" (string)',
    );
  }

  if (hasAgent) {
    const budget = isRecord(run.budget) ? run.budget : undefined;
    if (
      !budget ||
      typeof budget.maxCents !== 'number' ||
      typeof budget.maxWallClockMs !== 'number'
    ) {
      errors.push(
        'sandbox agent run requires a bounded "budget" { maxCents, maxWallClockMs }',
      );
    }
  }

  if (hasScript) {
    const language = getString(run, 'language');
    if (!language || !SCRIPT_LANGUAGES.has(language)) {
      errors.push(
        `sandbox script run requires "language" in [${[...SCRIPT_LANGUAGES].join(', ')}]`,
      );
    }
  }

  // Optional multi-file staging: each entry stages an org skill's declared
  // subtrees. Deep slug/path validation happens at run time (stage_skills.ts);
  // here we catch the shape + the security-critical path shapes at publish.
  if (hasScript && run.useSkills !== undefined) {
    if (!Array.isArray(run.useSkills)) {
      errors.push('sandbox "run.useSkills" must be an array');
    } else {
      for (const spec of run.useSkills) {
        if (
          !isRecord(spec) ||
          typeof spec.slug !== 'string' ||
          spec.slug.length === 0 ||
          !Array.isArray(spec.include) ||
          spec.include.length === 0
        ) {
          errors.push(
            'each sandbox useSkills entry needs { slug: string, include: non-empty string[] }',
          );
          continue;
        }
        for (const inc of spec.include) {
          if (
            typeof inc !== 'string' ||
            inc.length === 0 ||
            inc.startsWith('/') ||
            inc.split(/[\\/]+/).some((s) => s === '..')
          ) {
            errors.push(
              `sandbox useSkills "${spec.slug}" include "${String(inc)}" must be a relative path without ".."`,
            );
          }
        }
      }
    }
  }

  if (config.env !== undefined) {
    if (!isRecord(config.env)) {
      errors.push('sandbox "env" must be an object of string values');
    } else {
      for (const [name, value] of Object.entries(config.env)) {
        if (typeof value !== 'string') {
          errors.push(`sandbox env "${name}" must be a string value`);
        }
      }
    }
  }

  if (config.inputs !== undefined) {
    if (!Array.isArray(config.inputs)) {
      errors.push('sandbox "inputs" must be an array');
    } else {
      for (const input of config.inputs) {
        if (!isRecord(input) || typeof input.as !== 'string') {
          errors.push('each sandbox input requires an "as" path (string)');
          continue;
        }
        const from = isRecord(input.from) ? input.from : undefined;
        const sourceKeys = from
          ? INPUT_SOURCE_KEYS.filter((k) => k in from)
          : [];
        if (sourceKeys.length !== 1) {
          errors.push(
            `sandbox input "${input.as}" needs exactly one source: fileId | folderId | folderPath | content`,
          );
        }
      }
    }
  }

  return { valid: errors.length === 0, errors, warnings };
}
