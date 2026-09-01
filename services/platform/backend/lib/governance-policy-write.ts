import { mkdir } from 'node:fs/promises';
import path from 'node:path';

import type { FilePolicyType } from '../../lib/shared/schemas/governance.ts';
import {
  MAX_HISTORY_ENTRIES,
  resolveHistoryDir,
  resolvePolicyFilePath,
  resolvePolicyYamlFilePath,
  serializePolicyYaml,
} from '../core/governance/file_utils.ts';
import {
  atomicWrite,
  generateHistoryTimestamp,
  pruneHistory,
  readFileSafe,
  removeFileSafe,
} from '../core/lib/file_io.ts';
import { clearOrgConfigCaches } from './org-config.ts';

/**
 * Persist one governance policy file (the 0.4 `writePolicyFileAndSync`
 * semantics): snapshot the current content into history first, then the
 * atomic yaml write; the legacy json twin is removed so a later read can't
 * resurrect stale content. pg readers go straight to the files, so the only
 * cache to bust is org-config's own short-lived one.
 */
export async function writeGovernancePolicyFile(
  orgSlug: string,
  policyType: FilePolicyType,
  config: unknown,
): Promise<void> {
  const yamlPath = resolvePolicyYamlFilePath(orgSlug, policyType);
  const jsonPath = resolvePolicyFilePath(orgSlug, policyType);
  const currentYaml = await readFileSafe(yamlPath);
  const currentContent = currentYaml ?? (await readFileSafe(jsonPath));
  if (currentContent !== null) {
    const historyDir = resolveHistoryDir(orgSlug, policyType);
    await mkdir(historyDir, { recursive: true });
    await atomicWrite(
      path.join(
        historyDir,
        `${generateHistoryTimestamp()}.${currentYaml !== null ? 'yml' : 'json'}`,
      ),
      currentContent,
    );
    await pruneHistory(historyDir, MAX_HISTORY_ENTRIES);
  }
  await atomicWrite(yamlPath, serializePolicyYaml(policyType, config));
  await removeFileSafe(jsonPath);
  // Coarse but correct: the TTL cache is small and per-process (15s).
  clearOrgConfigCaches();
}
