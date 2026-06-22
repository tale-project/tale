import { isRecord } from '@/lib/utils/type-utils';

import { getTemplateIconUrl } from '../components/integration-upload/constants/integration-templates';
import type { IntegrationListItem } from '../components/integrations';

/**
 * Merge a file-based integration definition with its DB credential row into the
 * shape the manage hook + credentials form consume. The single source of truth
 * for "file config + DB credential → Integration", so the settings page and the
 * app-install wizard can't drift. When no credential exists yet, `_id` falls
 * back to the slug (the uninstalled-stub convention `handleTestConnection` keys
 * on to install the credential lazily on first connect).
 */
function mergeConfig(fileVal: unknown, credVal: unknown): unknown {
  if (isRecord(credVal) && isRecord(fileVal)) {
    return { ...fileVal, ...credVal };
  }
  return credVal ?? fileVal;
}

export function mergeIntegrationListItem(
  item: Record<string, unknown>,
  cred: (Record<string, unknown> & { _id?: string }) | undefined,
  organizationId: string,
): IntegrationListItem {
  const slug = String(item.slug);
  const merged = {
    ...item,
    _id: cred?._id ?? slug,
    name: slug,
    organizationId,
    isActive: cred?.isActive ?? false,
    status: cred?.status ?? 'inactive',
    authMethod: cred?.authMethod ?? item.authMethod,
    oauth2Config: mergeConfig(item.oauth2Config, cred?.oauth2Config),
    basicAuth: cred?.basicAuth ?? item.basicAuth,
    apiKeyAuth: cred?.apiKeyAuth ?? item.apiKeyAuth,
    oauth2Auth: cred?.oauth2Auth ?? item.oauth2Auth,
    connectionConfig: mergeConfig(
      item.connectionConfig,
      cred?.connectionConfig,
    ),
    sqlConnectionConfig: mergeConfig(
      item.sqlConnectionConfig,
      cred?.sqlConnectionConfig,
    ),
    iconUrl:
      typeof item.iconUrl === 'string'
        ? item.iconUrl
        : getTemplateIconUrl(slug),
  };
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- merging file + DB data into the IntegrationListItem shape
  return merged as unknown as IntegrationListItem;
}
