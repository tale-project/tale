'use node';

/**
 * Reads delegate agent JSON files from the filesystem and converts them to
 * `DelegateAgentMeta`. A single bad/missing delegate is skipped rather than
 * failing the whole load, so the rest of the delegation tools stay available.
 */

import { readFile, stat } from 'node:fs/promises';

import { resolveAgentLocale } from '../../../lib/shared/utils/resolve-agent-locale';
import type { ActionCtx } from '../../_generated/server';
import { toSerializableConfig } from '../../agents/config';
import {
  MAX_FILE_SIZE_BYTES,
  parseAgentJson,
  resolveAgentFilePath,
  resolveAgentFilePathFromRelative,
} from '../../agents/file_utils';
import { resolveAgentRelativePath } from '../../agents/internal_actions';
import type { DelegateAgentMeta } from './create_delegation_tool';

export async function loadDelegateAgents(
  ctx: ActionCtx,
  delegateNames: string[],
  organizationId: string,
  orgSlug: string,
  orgLocale?: string,
): Promise<DelegateAgentMeta[]> {
  if (delegateNames.length === 0) return [];

  const delegates: DelegateAgentMeta[] = [];

  for (const name of delegateNames) {
    try {
      // Locate the backing file through the folder-aware index (chat/,
      // workforce/, github/, …) — a flat `<slug>.json` fallback covers a
      // brand-new file written before the 60s index cache refreshed. Without
      // this, every foldered agent (the entire workforce) resolved to a
      // non-existent flat path and was silently skipped as "not found".
      const rel = await resolveAgentRelativePath(orgSlug, name);
      const filePath = rel
        ? resolveAgentFilePathFromRelative(orgSlug, rel)
        : resolveAgentFilePath(orgSlug, name);
      const fileStat = await stat(filePath);
      if (fileStat.size > MAX_FILE_SIZE_BYTES) {
        console.warn(
          `Delegate agent "${name}" skipped: file exceeds ${MAX_FILE_SIZE_BYTES} bytes.`,
        );
        continue;
      }

      const content = await readFile(filePath, 'utf-8');
      const config = parseAgentJson(content);
      const agentConfig = toSerializableConfig(
        name,
        config,
        undefined,
        orgLocale,
      );
      const resolved = resolveAgentLocale(config, orgLocale ?? 'en');

      delegates.push({
        agentSlug: name,
        name,
        displayName: resolved.displayName,
        description: resolved.description ?? '',
        agentConfig,
        // `toSerializableConfig` guarantees a non-empty model (supportedModels[0]);
        // its `fallbackModels` (supportedModels[1:]) ride along on `agentConfig`
        // and drive the SAME primary→fallback failover a top-level agent gets
        // (internal_actions builds modelsToTry from agentConfig.fallbackModels).
        // The old `?? ''` could pass an empty model id — drop it.
        model: agentConfig.model ?? config.supportedModels[0],
        provider: agentConfig.provider,
        roleRestriction: config.roleRestriction,
      });
    } catch (err) {
      // ENOENT = the delegate file was removed (expected; quiet). Anything else
      // (parse / validation error) is a config bug the operator must see.
      const code =
        err != null && typeof err === 'object'
          ? Reflect.get(err, 'code')
          : undefined;
      if (code === 'ENOENT') {
        console.warn(`Delegate agent "${name}" not found; skipping.`);
      } else {
        console.error(
          `Delegate agent "${name}" is misconfigured; skipping. Fix its JSON so the delegation tool is available.`,
          err instanceof Error ? err.message : err,
        );
      }
    }
  }

  return delegates;
}
