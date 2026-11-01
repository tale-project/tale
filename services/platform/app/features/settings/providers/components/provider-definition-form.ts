import {
  providerDefinitionSchema,
  type ApiFormat,
  type ProviderDefinition,
} from '@tale/shared/schemas/providers';

import type { Translator } from '@/app/features/settings/credentials/adapter';
import { mapCredentialError } from '@/app/features/settings/credentials/map-credential-error';
import { backendErrorCode } from '@/app/hooks/use-action-query';
import { BackendApiError } from '@/app/lib/backend/api-client';
import type { ProviderCatalogFailureCode } from '@/app/lib/backend/contract/lib';
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

/** What the page says of each listing failure the server codes: the
 * sentence of what went wrong, with the fix where the reader has one, and
 * whether the server's words follow it. They do where they help a diagnosis
 * and quote nothing the endpoint answered: the status, or what failed of the
 * connection. The words of a listing that answered without a model list name
 * the listing URL instead, which may carry a key. */
const LISTING_FAILURES = {
  PROVIDER_CATALOG_NOT_JSON: {
    sentenceKey: 'providers.custom.errors.catalogNotJson',
    showsDetail: false,
  },
  PROVIDER_CATALOG_NOT_FOUND: {
    sentenceKey: 'providers.custom.errors.catalogNotFound',
    showsDetail: false,
  },
  PROVIDER_CATALOG_KEY_REFUSED: {
    sentenceKey: 'providers.custom.errors.catalogKeyRefused',
    showsDetail: true,
  },
  PROVIDER_CATALOG_UPSTREAM_ERROR: {
    sentenceKey: 'providers.custom.errors.catalogUpstreamError',
    showsDetail: true,
  },
  PROVIDER_CATALOG_UNREACHABLE: {
    sentenceKey: 'providers.custom.errors.catalogUnreachable',
    showsDetail: true,
  },
} as const satisfies Record<
  ProviderCatalogFailureCode,
  { sentenceKey: `providers.custom.errors.${string}`; showsDetail: boolean }
>;

function isListingFailureCode(
  code: string | undefined,
): code is ProviderCatalogFailureCode {
  return code !== undefined && Object.hasOwn(LISTING_FAILURES, code);
}

/**
 * Why a provider's model listing could not be read, for the row and the
 * refresh report, in the reader's language: the sentence of its code, with
 * the server's words after it where they help a diagnosis
 * ({@link LISTING_FAILURES}). A failure without a code reads the general
 * sentence alone: its words may quote the listing URL or what the endpoint
 * answered, so they stay in the server's log.
 */
export function catalogFailureText(
  t: Translator,
  error: string,
  code: ProviderCatalogFailureCode | undefined,
): string {
  if (!isListingFailureCode(code)) {
    return t('providers.custom.errors.catalogUnavailable');
  }
  const { sentenceKey, showsDetail } = LISTING_FAILURES[code];
  const sentence = t(sentenceKey);
  return showsDetail
    ? t('providers.catalogs.failureDetail', { sentence, detail: error })
    : sentence;
}

/** The localized sentence of a coded listing failure — `undefined` for any
 * other code. */
function listingFailureSentence(
  t: Translator,
  code: string | undefined,
): string | undefined {
  return isListingFailureCode(code)
    ? t(LISTING_FAILURES[code].sentenceKey)
    : undefined;
}

/**
 * Admin-facing copy for a failed provider write or listing. The backend's
 * refusals are coded, and each code has a localized sentence naming the fix:
 * the provider's own here, the ones every credential surface shares through
 * `mapCredentialError`, which also words anything else without the server's
 * text. A failed listing answers 502, which reaches here as the transport's
 * own error rather than an `AppError`, so its code is read off that.
 */
export function mapProviderDefinitionError(
  t: Translator,
  err: unknown,
): string {
  const code =
    err instanceof BackendApiError ? err.code : backendErrorCode(err);
  switch (code) {
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
    case 'CREDENTIAL_IN_USE':
      return t('providers.credential.inUseByEmbedding');
    case 'CREDENTIAL_ACCOUNT_ID_INVALID':
      return t('providers.credential.accountIdInvalid');
    case 'CREDENTIAL_ENDPOINT_INVALID':
      return t('providers.credential.endpointInvalid');
    case 'CREDENTIAL_ENV_NAME_INVALID':
      return t('providers.credential.envNameInvalid');
    case 'CREDENTIAL_SECRET_REQUIRED':
      return t('providers.credential.secretRequired');
    case 'CREDENTIAL_SECRET_INVALID':
      return t('providers.credential.secretInvalid');
    case 'CREDENTIAL_BROKER_CONFIG_INVALID':
      return t('providers.broker.refused');
    case 'PROVIDER_CATALOG_UNAVAILABLE':
      return t('providers.custom.errors.catalogUnavailable');
    default:
      return listingFailureSentence(t, code) ?? mapCredentialError(err);
  }
}
