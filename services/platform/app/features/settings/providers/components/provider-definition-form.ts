import {
  providerDefinitionSchema,
  type ApiFormat,
  type ProviderDefinition,
} from '@tale/shared/schemas/providers';

import type { Translator } from '@/app/features/settings/credentials/adapter';
import { mapCredentialError } from '@/app/features/settings/credentials/map-credential-error';
import { backendErrorCode } from '@/app/hooks/use-action-query';
import { formatZodError } from '@/lib/shared/schemas/format-error';

/**
 * The custom provider as the credential dialog authors it: the facts the
 * reader types beside the key (wire format, base URL, how models are listed)
 * and their projection into the native `providerDefinitionSchema` document
 * the backend writes.
 *
 * The rest of the schema (an `embedding` claim, a subscription-flavoured auth
 * method bound to a harness, a coding-agent endpoint) is a hand-authored fact
 * with no field: a definition that carries one keeps it through an edit
 * rather than losing it to the dialog.
 */

/** The picker's pinned "define your own" entry — never a real slug. */
export const CUSTOM_VENDOR_KEY = '__custom-provider__';

export interface CustomProviderFacts {
  /** The provider the facts belong to: {@link CUSTOM_VENDOR_KEY} while it
   * is being created, its slug once it exists. */
  providerSlug: string;
  apiFormat: ApiFormat;
  baseUrl: string;
  /** `models-endpoint` discovers models from the endpoint's own listing;
   * `none` means the credential's allowlist names them. */
  catalogSource: 'models-endpoint' | 'none';
}

export function emptyCustomProviderFacts(): CustomProviderFacts {
  return {
    providerSlug: CUSTOM_VENDOR_KEY,
    apiFormat: 'openai',
    baseUrl: '',
    catalogSource: 'models-endpoint',
  };
}

/** The slug a display name suggests: lower-case, dashes for everything else,
 * cut to the schema's 64 characters. */
export function slugifyProviderName(displayName: string): string {
  return displayName
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
    .replace(/-+$/g, '');
}

/**
 * A slug for a new custom provider that no shipped or existing provider
 * carries: the name's own slug, numbered past the taken ones ("qwen-cn",
 * then "qwen-cn-2"). A name that slugs to nothing becomes `custom-provider`.
 */
export function uniqueProviderSlug(
  displayName: string,
  taken: ReadonlySet<string>,
): string {
  const base = slugifyProviderName(displayName) || 'custom-provider';
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) {
    const suffix = `-${n}`;
    const candidate = `${base.slice(0, 64 - suffix.length)}${suffix}`;
    if (!taken.has(candidate)) return candidate;
  }
}

/**
 * The native document for a custom provider, or the reason the schema
 * refuses it. `existing` is the definition being edited: everything the
 * dialog has no field for rides along, except an `openai-modern` dialect
 * once the wire is no longer OpenAI's (the schema refuses that pair).
 */
export function buildCustomProviderDefinition(
  input: {
    name: string;
    displayName: string;
    apiFormat: ApiFormat;
    baseUrl: string;
    catalogSource: CustomProviderFacts['catalogSource'];
  },
  existing?: ProviderDefinition,
): { ok: true; config: ProviderDefinition } | { ok: false; message: string } {
  const carried: Partial<ProviderDefinition> =
    existing === undefined ? {} : { ...existing };
  delete carried.wireDialect;
  const draft = {
    ...carried,
    name: input.name,
    displayName: input.displayName.trim(),
    apiFormat: input.apiFormat,
    ...(input.apiFormat === 'openai' && existing?.wireDialect !== undefined
      ? { wireDialect: existing.wireDialect }
      : {}),
    baseUrl: input.baseUrl.trim(),
    catalog: { source: input.catalogSource },
    auth: existing?.auth ?? [
      { method: 'api-key' as const },
      { method: 'env' as const },
    ],
  };
  const outcome = providerDefinitionSchema.safeParse(draft);
  return outcome.success
    ? { ok: true, config: outcome.data }
    : { ok: false, message: formatZodError(outcome.error) };
}

/**
 * Admin-facing copy for a failed provider write or listing. The backend's
 * refusals are coded, and each code has a localized sentence naming the fix;
 * anything else keeps the server's own sentence via `mapCredentialError`.
 */
export function mapProviderDefinitionError(
  t: Translator,
  err: unknown,
): string {
  switch (backendErrorCode(err)) {
    case 'PROVIDER_NAME_RESERVED':
      return t('providers.custom.errors.nameReserved');
    case 'PROVIDER_ENDPOINT_INVALID':
      return t('providers.custom.errors.endpointNotPermitted');
    case 'PROVIDER_IN_USE':
      return t('providers.custom.errors.inUse');
    case 'CONFIG_VERSION_CONFLICT':
      return t('providers.custom.errors.versionConflict');
    case 'PROVIDER_DEFINITION_INVALID':
      return t('providers.custom.errors.invalid');
    case 'PROVIDER_NOT_FOUND':
      return t('providers.custom.errors.notFound');
    case 'PROVIDER_CATALOG_UNAVAILABLE':
      return t('providers.custom.errors.catalogUnavailable');
    default:
      return mapCredentialError(err);
  }
}
