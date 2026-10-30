import {
  providerDefinitionSchema,
  type ApiFormat,
  type DeclaredModel,
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
 * reader types beside the key (wire format, base URL, how models are listed,
 * and — without a listing — what each allowlisted model can take) and their
 * projection into the native `providerDefinitionSchema` document the backend
 * writes.
 *
 * The rest of the schema (an `embedding` claim, a subscription-flavoured auth
 * method bound to a harness, a coding-agent endpoint) is a hand-authored fact
 * with no field: a definition that carries one keeps it through an edit
 * rather than losing it to the dialog.
 */

/** The picker's pinned "define your own" entry — never a real slug. */
export const CUSTOM_VENDOR_KEY = '__custom-provider__';

/** One model's facts as the dialog holds them: the window as typed (blank
 * declares none) and whether the model reads images. */
export interface ModelFactsDraft {
  contextWindow: string;
  supportsVision: boolean;
}

export interface CustomProviderFacts {
  /** The provider the facts belong to: {@link CUSTOM_VENDOR_KEY} while it
   * is being created, its slug once it exists. */
  providerSlug: string;
  apiFormat: ApiFormat;
  baseUrl: string;
  /** `models-endpoint` discovers models from the endpoint's own listing;
   * `none` means the credential's allowlist names them. */
  catalogSource: 'models-endpoint' | 'none';
  /** For `none`: what each model can take, by id. The dialog shows and saves
   * the ids the allowlist names; the definition's facts for any other id
   * ride along untouched. */
  modelFacts: Readonly<Record<string, ModelFactsDraft>>;
}

export function emptyCustomProviderFacts(): CustomProviderFacts {
  return {
    providerSlug: CUSTOM_VENDOR_KEY,
    apiFormat: 'openai',
    baseUrl: '',
    catalogSource: 'models-endpoint',
    modelFacts: {},
  };
}

const BLANK_MODEL_FACTS: ModelFactsDraft = {
  contextWindow: '',
  supportsVision: false,
};

/** The draft of one model: what was typed for it, else blank. */
export function modelFactsDraft(
  drafts: Readonly<Record<string, ModelFactsDraft>>,
  id: string,
): ModelFactsDraft {
  return Object.hasOwn(drafts, id)
    ? (drafts[id] ?? BLANK_MODEL_FACTS)
    : BLANK_MODEL_FACTS;
}

/** The drafts a definition's declared models seed the dialog with — own
 * keys only, so an id such as `__proto__` stays a model id. */
export function modelFactsDrafts(
  declared: readonly DeclaredModel[] | undefined,
): Record<string, ModelFactsDraft> {
  return Object.fromEntries(
    (declared ?? []).map((model) => [
      model.id,
      {
        contextWindow:
          model.contextWindow === undefined ? '' : String(model.contextWindow),
        supportsVision: model.supportsVision === true,
      },
    ]),
  );
}

/**
 * A typed context window: `undefined` for a blank field (no window
 * declared), `null` for anything but a positive whole number of tokens.
 */
export function contextWindowOf(text: string): number | undefined | null {
  const trimmed = text.trim();
  if (trimmed === '') return undefined;
  if (!/^\d+$/.test(trimmed)) return null;
  const tokens = Number(trimmed);
  return Number.isSafeInteger(tokens) && tokens > 0 ? tokens : null;
}

/** Whether every shown model's window is blank or a usable number. */
export function modelFactsComplete(
  ids: readonly string[],
  drafts: Readonly<Record<string, ModelFactsDraft>>,
): boolean {
  return ids.every(
    (id) => contextWindowOf(modelFactsDraft(drafts, id).contextWindow) !== null,
  );
}

/** Whether two sets of drafts declare the same facts for the given ids. */
export function sameModelFacts(
  ids: readonly string[],
  a: Readonly<Record<string, ModelFactsDraft>>,
  b: Readonly<Record<string, ModelFactsDraft>>,
): boolean {
  return ids.every((id) => {
    const left = modelFactsDraft(a, id);
    const right = modelFactsDraft(b, id);
    return (
      left.contextWindow.trim() === right.contextWindow.trim() &&
      left.supportsVision === right.supportsVision
    );
  });
}

/** One shown model as the definition declares it — `null` when the reader
 * declared nothing for it. An unreadable window is never dropped quietly: it
 * goes on as a number the schema refuses. */
function declaredModel(
  id: string,
  draft: ModelFactsDraft,
): DeclaredModel | null {
  const tokens = contextWindowOf(draft.contextWindow);
  if (tokens === undefined && !draft.supportsVision) return null;
  return {
    id,
    ...(tokens !== undefined ? { contextWindow: tokens ?? Number.NaN } : {}),
    ...(draft.supportsVision ? { supportsVision: true } : {}),
  };
}

/**
 * The models a catalog-less definition declares after the dialog's save: the
 * stored declarations in their order, each shown id's replaced by what the
 * dialog holds for it (or dropped once it declares nothing), then the shown
 * ids declared for the first time, in allowlist order. An id the dialog does
 * not show — another credential's, or one written into the file by hand —
 * keeps its declaration.
 */
export function declaredModels(
  stored: readonly DeclaredModel[],
  shown: readonly string[],
  drafts: Readonly<Record<string, ModelFactsDraft>>,
): DeclaredModel[] {
  const shownIds = new Set(shown);
  const declared: DeclaredModel[] = [];
  const placed = new Set<string>();
  for (const model of stored) {
    if (!shownIds.has(model.id)) {
      declared.push(model);
      continue;
    }
    placed.add(model.id);
    const next = declaredModel(model.id, modelFactsDraft(drafts, model.id));
    if (next !== null) declared.push(next);
  }
  for (const id of shown) {
    if (placed.has(id)) continue;
    placed.add(id);
    const next = declaredModel(id, modelFactsDraft(drafts, id));
    if (next !== null) declared.push(next);
  }
  return declared;
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

/** The catalog a definition is saved with: a listing source as chosen, or
 * no listing with the models the dialog and the stored file declare. */
function catalogOf(
  input: {
    catalogSource: CustomProviderFacts['catalogSource'];
    allowlist: readonly string[];
    modelFacts: Readonly<Record<string, ModelFactsDraft>>;
  },
  existing: ProviderDefinition | undefined,
): ProviderDefinition['catalog'] {
  if (input.catalogSource !== 'none') return { source: input.catalogSource };
  const stored =
    existing?.catalog.source === 'none' ? (existing.catalog.models ?? []) : [];
  const models = declaredModels(stored, input.allowlist, input.modelFacts);
  return models.length > 0 ? { source: 'none', models } : { source: 'none' };
}

/**
 * The native document for a custom provider, or the reason the schema
 * refuses it. `existing` is the definition being edited: everything the
 * dialog has no field for rides along, except an `openai-modern` dialect
 * once the wire is no longer OpenAI's (the schema refuses that pair). A
 * provider without a listing declares the facts the dialog holds for the
 * allowlisted ids, and keeps what the stored file declares for the others.
 */
export function buildCustomProviderDefinition(
  input: {
    name: string;
    displayName: string;
    apiFormat: ApiFormat;
    baseUrl: string;
    catalogSource: CustomProviderFacts['catalogSource'];
    /** The ids the credential's allowlist names — the models whose facts
     * the dialog shows. */
    allowlist: readonly string[];
    modelFacts: Readonly<Record<string, ModelFactsDraft>>;
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
    catalog: catalogOf(input, existing),
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
 * Why a provider's model listing could not be read, for the row, the refresh
 * report and the listing check: a listing that answered without a model list
 * names the fix in the reader's language; anything else keeps its message.
 */
export function catalogFailureText(
  t: Translator,
  error: string,
  code: ProviderCatalogFailureCode | undefined,
): string {
  return listingFailureSentence(t, code) ?? error;
}

/** The localized fix for a listing that answered without a model list —
 * `undefined` for any other code. */
function listingFailureSentence(
  t: Translator,
  code: string | undefined,
): string | undefined {
  switch (code) {
    case 'PROVIDER_CATALOG_NOT_JSON':
      return t('providers.custom.errors.catalogNotJson');
    case 'PROVIDER_CATALOG_NOT_FOUND':
      return t('providers.custom.errors.catalogNotFound');
    default:
      return undefined;
  }
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
