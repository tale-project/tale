import {
  providerDefinitionSchema,
  type ApiFormat,
  type CatalogSource,
  type ProviderDefinition,
} from '@tale/shared/schemas/providers';

import type { Translator } from '@/app/features/settings/credentials/adapter';
import { mapCredentialError } from '@/app/features/settings/credentials/map-credential-error';
import { backendErrorCode } from '@/app/hooks/use-action-query';
import { formatZodError } from '@/lib/shared/schemas/format-error';

/**
 * The custom-provider dialog's form state and its two projections: a stored
 * definition INTO the fields, and the fields back OUT into the native
 * `providerDefinitionSchema` document the backend writes.
 *
 * The form covers what an organization defining its own endpoint decides —
 * wire format, base URL, how models are listed, which credential methods are
 * accepted — plus the three advanced facts a gateway operator may need. The
 * rest of the schema (an `embedding` claim, a subscription-flavoured auth
 * method bound to a harness) is a hand-authored fact with no form: a file that
 * carries one keeps it through an edit rather than losing it to the dialog.
 */

/** The catalog sources the dialog offers. The other two (`static`, which has
 * no organization-side models file, and `openrouter-api`) only appear when a
 * hand-written file already uses them. */
export const OFFERED_CATALOG_SOURCES = ['models-endpoint', 'none'] as const;

/** The credential methods a custom provider can accept from the form. */
export const OFFERED_AUTH_METHODS = ['api-key', 'env'] as const;
export type OfferedAuthMethod = (typeof OFFERED_AUTH_METHODS)[number];

export interface ProviderDefinitionFormValues {
  displayName: string;
  /** The slug — the provider's key and its file name. */
  name: string;
  apiFormat: ApiFormat;
  baseUrl: string;
  catalogSource: CatalogSource['source'];
  authMethods: string[];
  /** `wireDialect: openai-modern` — meaningful for `apiFormat: openai` only. */
  modernOpenAiWire: boolean;
  /** `endpointMode: per-credential` — each credential carries its own URL. */
  perCredentialEndpoint: boolean;
  harnessEndpointUrl: string;
  harnessEndpointFormat: ApiFormat;
}

export function emptyProviderDefinitionForm(): ProviderDefinitionFormValues {
  return {
    displayName: '',
    name: '',
    apiFormat: 'openai',
    baseUrl: '',
    catalogSource: 'models-endpoint',
    authMethods: [...OFFERED_AUTH_METHODS],
    modernOpenAiWire: false,
    perCredentialEndpoint: false,
    harnessEndpointUrl: '',
    harnessEndpointFormat: 'anthropic',
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

/** A stored definition as the dialog's fields. */
export function providerDefinitionToForm(
  config: ProviderDefinition,
): ProviderDefinitionFormValues {
  return {
    displayName: config.displayName,
    name: config.name,
    apiFormat: config.apiFormat,
    baseUrl: config.baseUrl ?? '',
    catalogSource: config.catalog.source,
    authMethods: config.auth
      .map((entry) => entry.method)
      .filter((method): method is OfferedAuthMethod =>
        (OFFERED_AUTH_METHODS as readonly string[]).includes(method),
      ),
    modernOpenAiWire: config.wireDialect === 'openai-modern',
    perCredentialEndpoint: config.endpointMode === 'per-credential',
    harnessEndpointUrl: config.harnessEndpoint?.baseUrl ?? '',
    harnessEndpointFormat: config.harnessEndpoint?.apiFormat ?? 'anthropic',
  };
}

/**
 * The dialog's fields as the native document. `existing` is the definition
 * being edited: the facts the form has no field for (`embedding`, subscription
 * auth methods) are carried over from it unchanged.
 */
export function providerDefinitionFromForm(
  values: ProviderDefinitionFormValues,
  existing?: ProviderDefinition,
): ProviderDefinition {
  const baseUrl = values.baseUrl.trim();
  const harnessEndpointUrl = values.harnessEndpointUrl.trim();
  const offered = new Set(values.authMethods);
  const auth: ProviderDefinition['auth'] = [
    ...OFFERED_AUTH_METHODS.filter((method) => offered.has(method)).map(
      (method) => ({ method }),
    ),
    ...(existing?.auth.filter(
      (entry) =>
        !(OFFERED_AUTH_METHODS as readonly string[]).includes(entry.method),
    ) ?? []),
  ];
  return {
    name: values.name.trim(),
    displayName: values.displayName.trim(),
    apiFormat: values.apiFormat,
    ...(values.apiFormat === 'openai' && values.modernOpenAiWire
      ? { wireDialect: 'openai-modern' as const }
      : {}),
    ...(baseUrl.length > 0 ? { baseUrl } : {}),
    ...(values.perCredentialEndpoint
      ? { endpointMode: 'per-credential' as const }
      : {}),
    ...(harnessEndpointUrl.length > 0
      ? {
          harnessEndpoint: {
            baseUrl: harnessEndpointUrl,
            apiFormat: values.harnessEndpointFormat,
          },
        }
      : {}),
    catalog: { source: values.catalogSource },
    ...(existing?.embedding !== undefined
      ? { embedding: existing.embedding }
      : {}),
    auth,
  };
}

/**
 * The native document for the fields, or the reason the schema refuses it.
 * The form validates each field as it is filled; this is the whole-document
 * gate the backend applies, run before the request so a refusal reads as
 * inline copy rather than a 400.
 */
export function buildProviderDefinition(
  values: ProviderDefinitionFormValues,
  existing?: ProviderDefinition,
): { ok: true; config: ProviderDefinition } | { ok: false; message: string } {
  const outcome = providerDefinitionSchema.safeParse(
    providerDefinitionFromForm(values, existing),
  );
  return outcome.success
    ? { ok: true, config: outcome.data }
    : { ok: false, message: formatZodError(outcome.error) };
}

/**
 * Admin-facing copy for a failed definition write or check. The backend's
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
