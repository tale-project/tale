import type { IntegrationTemplate } from '../constants/integration-templates';
import type { ParseResult } from './parse-integration-package';

import { getTemplateFileUrl } from '../constants/integration-templates';
import { parseIntegrationFiles } from './parse-integration-package';

const cache = new Map<string, ParseResult>();

/** @internal Clear the cache — only for testing. */
export function clearTemplateCache() {
  cache.clear();
}

export async function fetchTemplateFiles(
  template: IntegrationTemplate,
): Promise<ParseResult> {
  const cached = cache.get(template.name);
  if (cached) return cached;

  const configUrl = getTemplateFileUrl(template.name, 'config.json');
  const connectorUrl = getTemplateFileUrl(template.name, 'connector.ts');
  const iconUrl = getTemplateFileUrl(template.name, 'icon.svg');

  const [configResp, connectorResp, iconResp] = await Promise.all([
    fetch(configUrl),
    template.type !== 'sql' ? fetch(connectorUrl) : Promise.resolve(null),
    fetch(iconUrl),
  ]);

  if (!configResp.ok) {
    return {
      success: false,
      error: 'Failed to fetch template configuration from GitHub',
    };
  }

  const files: File[] = [];

  const configText = await configResp.text();
  files.push(
    new File([configText], 'config.json', { type: 'application/json' }),
  );

  if (connectorResp?.ok) {
    const connectorText = await connectorResp.text();
    files.push(
      new File([connectorText], 'connector.ts', {
        type: 'text/plain',
      }),
    );
  } else if (template.type !== 'sql' && connectorResp && !connectorResp.ok) {
    return {
      success: false,
      error: 'Failed to fetch template connector from GitHub',
    };
  }

  if (iconResp.ok) {
    const iconBlob = await iconResp.blob();
    files.push(new File([iconBlob], 'icon.svg', { type: 'image/svg+xml' }));
  }

  const result = await parseIntegrationFiles(files);

  if (result.success) {
    cache.set(template.name, result);
  }

  return result;
}
