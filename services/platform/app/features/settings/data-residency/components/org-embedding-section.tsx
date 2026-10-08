'use client';

/**
 * The organization's embedding model — which provider/model writes vectors
 * into its knowledge corpus, and at what width. Required for knowledge search
 * on ANY database (including the deployment default), which is why this
 * section has no enable switch: there is no "off" that works, only configured
 * or not-yet-configured.
 *
 * On the unified editor contract: fields batch through the settings header's
 * Discard/Save cluster; Remove is an instant action behind a confirm dialog.
 * The provider/credential selects offer the credentials already stored under
 * Settings → AI providers — the config only NAMES a credential, it never
 * carries a secret itself.
 */

import {
  isKnowledgeVectorWidth,
  KNOWLEDGE_VECTOR_WIDTHS,
} from '@tale/shared/schemas/knowledge';
import type { ProviderEmbeddingSupport } from '@tale/shared/schemas/providers';
import { Alert } from '@tale/ui/alert';
import { Badge } from '@tale/ui/badge';
import { Button } from '@tale/ui/button';
import { ConfirmDialog } from '@tale/ui/dialog/confirm-dialog';
import { useFormEditor, useRegisterGroupedEditor } from '@tale/ui/editor';
import { Input } from '@tale/ui/input';
import { HStack, Stack } from '@tale/ui/layout';
import { Select } from '@tale/ui/select';
import { Switch } from '@tale/ui/switch';
import { Text } from '@tale/ui/text';
import { useToast } from '@tale/ui/use-toast';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Controller } from 'react-hook-form';
import { z } from 'zod';

import {
  SettingsFieldList,
  SettingsFieldRow,
} from '@/app/features/settings/components/settings-field-list';
import { SettingsSection } from '@/app/features/settings/components/settings-section';
import {
  useProviderCatalogs,
  useProviderCredentials,
} from '@/app/features/settings/providers/hooks/queries';
import { useT } from '@/lib/i18n/client';

import {
  useDeleteOrgKnowledgeEmbedding,
  useSaveOrgKnowledgeEmbedding,
} from '../hooks/mutations';
import { useEmbeddingRecommendations } from '../hooks/queries';
import {
  mapOrgResidencyError,
  orgResidencyErrorCode,
} from '../org-residency-errors';
import { READ_ONLY_EMPTY, StatusBadge } from './residency-chrome';

/** The org's embedding config as the admin form reads it. */
export interface KnowledgeEmbeddingView {
  configured: boolean;
  /** False when the settings' credential selection no longer resolves —
   *  the named credential was deleted, or the provider has no default. */
  credentialResolvable?: boolean;
  providerSlug?: string;
  credentialId?: string;
  model?: string;
  dimensions?: number;
  baseUrl?: string;
}

/**
 * Where the model tag comes from: a pick from the provider's catalog, or a
 * tag typed by hand behind the "Other model…" choice. Carried in the form
 * values rather than component state so Discard, a remote update and the
 * dirty flag treat it like any other field.
 */
type ModelSource = 'catalog' | 'custom';

type EmbeddingForm = {
  providerSlug: string;
  credentialId: string; // DEFAULT_CREDENTIAL = the org's default for the provider
  model: string;
  modelSource: ModelSource;
  dimensions: string; // free numeric input; parsed on save (never guessed)
  baseUrl: string;
};

/** One embedding-tagged catalog entry, with the width when the catalog states one. */
interface EmbeddingCatalogModel {
  id: string;
  dimensions?: number;
}

/** What the org's catalog listing says about one provider's embedding models. */
interface ProviderEmbeddingCatalog {
  /** Shipped with the platform, or defined by this organization. */
  origin: 'shipped' | 'organization';
  catalogSource: 'none' | 'static' | 'openrouter-api' | 'models-endpoint';
  models: EmbeddingCatalogModel[];
  /** The listing could not be resolved — its emptiness proves nothing. */
  catalogError?: string;
}

const EMPTY_CATALOG_MODELS: EmbeddingCatalogModel[] = [];

/**
 * The shape the Model row takes for the chosen provider — decided by what
 * its connector declares and what its catalog can vouch for:
 *
 *  - `unsupported` — the provider cannot embed at all. The form says so and
 *    refuses it, whatever its listing carries: a model picked here would
 *    only fail later, at index time.
 *  - `pick` — the catalog lists embedding models: a select over them. A
 *    shipped catalog is authoritative, so the select is closed; a listing the
 *    organization defined itself may be incomplete (a bare `/models` answer
 *    tags nothing as an embedding model), so it keeps an "Other model…"
 *    escape into the free tag field.
 *  - `free` — no curated width to offer: a shipped catalog that lists no
 *    embedding model, a provider the organization defined without any
 *    embedding entry, a shipped provider without a catalog at all (`none`:
 *    Azure deployments carry the admin's own names), or a provider the
 *    listing does not know. The tag is typed, and the width with it.
 *  - `unavailable` — a shipped catalog that could not be loaded; refused,
 *    with the remedy named, since it may list the models to pick from.
 *  - `unchecked` — the declarations could not be read. Refused until a
 *    retry answers: without them "cannot embed" and "no curated width" look
 *    alike, and letting the choice through is how a provider that cannot
 *    embed got saved, only to fail at index time.
 */
type ModelRowShape =
  | { kind: 'pick'; allowCustom: boolean }
  | { kind: 'free' }
  | { kind: 'unsupported' }
  | { kind: 'unchecked' }
  | { kind: 'unavailable' };

type RefusalShape = Extract<
  ModelRowShape,
  { kind: 'unsupported' | 'unchecked' | 'unavailable' }
>;

/** The declarations read has not answered: pending, or failed. */
const SUPPORT_UNREAD = 'unread';

function modelRowShape(
  catalog: ProviderEmbeddingCatalog | undefined,
  /** What the connector declares, as the recommendations read reports it,
   *  or `unread` while that read has not answered. A provider the answered
   *  read does not list reads as `unknown`: it is never refused for want of
   *  evidence — but an unanswered read is no evidence of anything. */
  support: ProviderEmbeddingSupport | typeof SUPPORT_UNREAD | undefined,
): ModelRowShape {
  if (support === SUPPORT_UNREAD) return { kind: 'unchecked' };
  if (support === 'unsupported') return { kind: 'unsupported' };
  if (catalog === undefined) return { kind: 'free' };
  if (catalog.models.length > 0) {
    return { kind: 'pick', allowCustom: catalog.origin === 'organization' };
  }
  if (
    catalog.origin === 'shipped' &&
    catalog.catalogSource !== 'none' &&
    catalog.catalogError !== undefined
  ) {
    return { kind: 'unavailable' };
  }
  return { kind: 'free' };
}

/** The shapes that refuse the provider — the shared Save stays off. */
function isRefusal(shape: ModelRowShape): shape is RefusalShape {
  return (
    shape.kind === 'unsupported' ||
    shape.kind === 'unchecked' ||
    shape.kind === 'unavailable'
  );
}

/** What a refused Model row says: its status label and the hint naming why. */
const REFUSAL_COPY = {
  unsupported: {
    label: 'dataResidency.orgEmbedding.modelUnsupported',
    hint: 'dataResidency.orgEmbedding.modelUnsupportedHint',
  },
  unchecked: {
    label: 'dataResidency.orgEmbedding.modelUnchecked',
    hint: 'dataResidency.orgEmbedding.modelUncheckedHint',
  },
  unavailable: {
    label: 'dataResidency.orgEmbedding.modelUnavailable',
    hint: 'dataResidency.orgEmbedding.modelCatalogUnavailableHint',
  },
} as const satisfies Record<
  RefusalShape['kind'],
  { label: string; hint: string }
>;

/**
 * Sentinel for "the org's default credential for this provider" — a Radix
 * Select item may not carry an empty value, and a real Convex id can never
 * collide with this string.
 */
const DEFAULT_CREDENTIAL = '__default__';

/**
 * Sentinel for the "Other model…" choice of the model select — it reveals
 * the free tag field. A model id on the wire can never be this string.
 */
const CUSTOM_MODEL = '__custom__';

const EMPTY_FORM: EmbeddingForm = {
  providerSlug: '',
  credentialId: DEFAULT_CREDENTIAL,
  model: '',
  modelSource: 'catalog',
  dimensions: '',
  baseUrl: '',
};

function formFromView(
  view: KnowledgeEmbeddingView | undefined,
  catalogs: ReadonlyMap<string, ProviderEmbeddingCatalog>,
): EmbeddingForm | undefined {
  if (view === undefined) return undefined;
  if (!view.configured) return EMPTY_FORM;
  const model = view.model ?? '';
  // A stored tag the provider's catalog does not list is a hand-typed one:
  // the form opens on the tag field, not on a select that cannot show it.
  const listed = (catalogs.get(view.providerSlug ?? '')?.models ?? []).some(
    (entry) => entry.id === model,
  );
  return {
    providerSlug: view.providerSlug ?? '',
    credentialId: view.credentialId ?? DEFAULT_CREDENTIAL,
    model,
    modelSource: model !== '' && !listed ? 'custom' : 'catalog',
    dimensions: view.dimensions === undefined ? '' : String(view.dimensions),
    baseUrl: view.baseUrl ?? '',
  };
}

/** The widths a knowledge database stores, as the hint and the error name
 * them — the rule the door applies (`knowledgeEmbeddingWriteSchema`). */
const VECTOR_WIDTHS = KNOWLEDGE_VECTOR_WIDTHS.join(', ');

function isValidDimensions(value: string): boolean {
  return value.trim() !== '' && isKnowledgeVectorWidth(Number(value));
}

function isValidBaseUrl(value: string): boolean {
  if (value === '') return true;
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

const FORM_ID = 'org-embedding-form';

export function OrgEmbeddingSection({
  organizationId,
  view,
  readError,
  readOnly,
}: {
  organizationId: string;
  view: KnowledgeEmbeddingView | undefined;
  readError?: string;
  readOnly: boolean;
}) {
  const { t } = useT('settings');
  const { toast } = useToast();

  const save = useSaveOrgKnowledgeEmbedding(organizationId);
  const remove = useDeleteOrgKnowledgeEmbedding(organizationId);
  const credentialsQuery = useProviderCredentials(organizationId);
  const credentials = useMemo(
    () => credentialsQuery.data ?? [],
    [credentialsQuery.data],
  );

  // The org's provider catalogs, read from the same listing the AI-providers
  // and governance pages use: the embedding-tagged entries of the chosen
  // provider become the model picks, and an entry's curated vector width
  // lands in the width field so nobody looks it up by hand. Editable states
  // only — the read-only view shows the stored tag as it is.
  const catalogsEnabled = !readOnly && readError === undefined;
  const catalogsQuery = useProviderCatalogs(organizationId, {
    enabled: catalogsEnabled,
  });
  const embeddingCatalogs = useMemo(() => {
    const byProvider = new Map<string, ProviderEmbeddingCatalog>();
    for (const provider of catalogsQuery.data ?? []) {
      const models: EmbeddingCatalogModel[] = [];
      for (const entry of provider.models) {
        if (!entry.tags.includes('embedding')) continue;
        const model: EmbeddingCatalogModel = { id: entry.id };
        if (entry.embedding !== undefined) {
          model.dimensions = entry.embedding.dimensions;
        }
        models.push(model);
      }
      const catalog: ProviderEmbeddingCatalog = {
        // The listing marks an organization-defined provider; absent means
        // shipped (the platform's own set).
        origin: provider.origin ?? 'shipped',
        catalogSource: provider.catalogSource,
        models,
      };
      if (provider.catalogError !== undefined) {
        catalog.catalogError = provider.catalogError;
      }
      byProvider.set(provider.name, catalog);
    }
    return byProvider;
  }, [catalogsQuery.data]);
  // Each provider's declared embedding support, from the recommendations
  // read: "cannot embed" (refused) and "no curated width here" (typed by
  // hand) are different answers, and only the declaration can tell them
  // apart. Editable states only, like the catalogs. Undefined until the
  // read answers — never an empty map, which would read as "nothing is
  // refused" and let a provider that cannot embed through.
  const recommendationsQuery = useEmbeddingRecommendations(organizationId, {
    enabled: catalogsEnabled,
  });
  const embeddingSupport = useMemo(
    () =>
      recommendationsQuery.data === undefined
        ? undefined
        : new Map<string, ProviderEmbeddingSupport>(
            recommendationsQuery.data.providers.map((entry) => [
              entry.providerSlug,
              entry.support,
            ]),
          ),
    [recommendationsQuery.data],
  );
  // The Model row's shape for a provider — read by the schema so the shared
  // Save stays off while a refused one is chosen, and by the row to say why.
  const shapeOf = useCallback(
    (slug: string): ModelRowShape =>
      slug === ''
        ? { kind: 'free' }
        : modelRowShape(
            embeddingCatalogs.get(slug),
            embeddingSupport === undefined
              ? SUPPORT_UNREAD
              : embeddingSupport.get(slug),
          ),
    [embeddingCatalogs, embeddingSupport],
  );
  // The baseline waits for the catalogs AND the declarations: whether a
  // stored tag is a catalog pick or a hand-typed one is decided once, when
  // the form adopts its data — never re-decided under a form the admin is
  // already editing, which would read as a remote update — and no provider
  // can be chosen before the form knows which ones cannot embed. A failed
  // or disabled read settles too: a failed listing falls back to the free
  // tag field, a failed declarations read refuses every provider
  // (`unchecked`) until a retry answers.
  const catalogsSettled =
    !catalogsEnabled ||
    catalogsQuery.data !== undefined ||
    catalogsQuery.isError;
  // `isFetched` remains true while a failed read retries. Returning the
  // adopted baseline to undefined would suppress the editor's dirty source
  // and let navigation discard a draft without warning during that retry.
  const supportSettled = !catalogsEnabled || recommendationsQuery.isFetched;
  const supportReadFailed =
    catalogsEnabled &&
    recommendationsQuery.data === undefined &&
    recommendationsQuery.isError;
  // A failed listing leaves every provider without a catalog: the free field
  // is the fallback, but its emptiness is no evidence that Tale knows no
  // width — OpenAI's curated width may be just what the read failed to bring.
  const catalogsReadFailed =
    catalogsEnabled &&
    catalogsQuery.data === undefined &&
    catalogsQuery.isError;

  const [removeConfirmOpen, setRemoveConfirmOpen] = useState(false);

  // Same switch contract as the sibling sections: ON only REVEALS the form
  // (nothing is configured until the header Save commits), OFF on a saved
  // config routes through the remove confirm. Unlike the siblings, "off"
  // still shows the search-unavailable warning below — there is no working
  // default to fall back to, so the state stays visible while collapsed.
  const [enabled, setEnabled] = useState(Boolean(view?.configured));

  const configured = Boolean(view?.configured);
  useEffect(() => {
    setEnabled(configured);
  }, [configured]);

  // The group AND-s every registered section's validity into the shared Save.
  // A COMPLETELY empty form is valid while nothing is configured — "not
  // configured" is a legitimate resting state, and an untouched-empty section
  // isn't dirty, so the group never tries to save it. The moment any field is
  // filled, the full constraints apply; and once a config exists, clearing
  // the fields is invalid too (removal goes through the toggle, not an empty
  // save).
  const schema = useMemo(
    () =>
      z
        .object({
          providerSlug: z.string(),
          credentialId: z.string(),
          model: z.string(),
          modelSource: z.enum(['catalog', 'custom']),
          dimensions: z.string(),
          baseUrl: z.string(),
        })
        .superRefine((values, ctx) => {
          const empty =
            values.providerSlug === '' &&
            values.model === '' &&
            values.dimensions === '' &&
            values.baseUrl === '';
          if (empty && !configured) return;
          if (values.providerSlug === '') {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: ['providerSlug'],
              message: t('dataResidency.orgEmbedding.errors.providerRequired'),
            });
          }
          // A provider that cannot embed (or whose shipped catalog, or the
          // declarations, could not be read) is refused at the point of
          // choosing — the alternative is a tag that fails later, at index
          // time. The issue sits on the model, whose row already says so: it
          // keeps the shared Save off without a second line under the
          // provider pick.
          const refusal = shapeOf(values.providerSlug);
          if (isRefusal(refusal)) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: ['model'],
              message: t(REFUSAL_COPY[refusal.kind].hint, {
                provider: values.providerSlug,
              }),
            });
          }
          if (values.model === '') {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: ['model'],
              message: t('dataResidency.orgEmbedding.errors.modelRequired'),
            });
          }
          if (!isValidDimensions(values.dimensions)) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: ['dimensions'],
              message: t(
                'dataResidency.orgEmbedding.errors.dimensionsInvalid',
                { widths: VECTOR_WIDTHS },
              ),
            });
          }
          if (!isValidBaseUrl(values.baseUrl)) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: ['baseUrl'],
              message: t('dataResidency.orgEmbedding.errors.baseUrlInvalid'),
            });
          }
        }),
    [t, configured, shapeOf],
  );

  const baselineSettled = catalogsSettled && supportSettled;
  const data = useMemo(
    () => (baselineSettled ? formFromView(view, embeddingCatalogs) : undefined),
    [view, embeddingCatalogs, baselineSettled],
  );

  const saveForm = useCallback(
    async (values: EmbeddingForm) => {
      try {
        await save.mutateAsync({
          organizationId,
          providerSlug: values.providerSlug,
          credentialId:
            values.credentialId === DEFAULT_CREDENTIAL
              ? undefined
              : values.credentialId,
          model: values.model.trim(),
          dimensions: Number(values.dimensions),
          baseUrl: values.baseUrl.trim() || undefined,
        });
      } catch (err) {
        // A credential rejection belongs under the credential select, and
        // the door's "cannot embed" refusal under the model — rethrow them
        // untouched so `mapServerError` can pin them there; anything else
        // becomes the translated line the header cluster toasts once.
        const code = orgResidencyErrorCode(err);
        if (
          code === 'CREDENTIAL_NOT_FOUND' ||
          code === 'CREDENTIAL_PROVIDER_MISMATCH' ||
          code === 'CREDENTIAL_DISABLED' ||
          code === 'EMBEDDING_PROVIDER_UNSUPPORTED'
        ) {
          throw err;
        }
        throw new Error(mapOrgResidencyError(err, t), { cause: err });
      }
    },
    [organizationId, save, t],
  );

  // The codes rethrown by `saveForm` land here as field issues — the fix
  // (pick another credential, or another provider) happens right at the row.
  const mapServerError = useCallback(
    (err: unknown) => {
      const code = orgResidencyErrorCode(err);
      // The door refuses a provider declared unable to embed — reached when
      // the save raced the declarations read, or the declaration changed
      // after the page loaded.
      if (code === 'EMBEDDING_PROVIDER_UNSUPPORTED') {
        return [
          {
            path: 'model',
            message: t('dataResidency.orgEmbedding.errors.providerUnsupported'),
          },
        ];
      }
      if (code === 'CREDENTIAL_NOT_FOUND') {
        return [
          {
            path: 'credentialId',
            message: t('dataResidency.orgEmbedding.errors.credentialNotFound'),
          },
        ];
      }
      if (code === 'CREDENTIAL_PROVIDER_MISMATCH') {
        return [
          {
            path: 'credentialId',
            message: t('dataResidency.orgEmbedding.errors.credentialMismatch'),
          },
        ];
      }
      if (code === 'CREDENTIAL_DISABLED') {
        return [
          {
            path: 'credentialId',
            message: t('dataResidency.orgEmbedding.errors.credentialDisabled'),
          },
        ];
      }
      return null;
    },
    [t],
  );

  const editor = useFormEditor<EmbeddingForm>({
    data,
    defaultValues: EMPTY_FORM,
    schema,
    save: saveForm,
    // The reveal switch lives outside the form, so a Discard — the header's
    // as much as this section's — has to put it back to the saved state too.
    onReset: () => setEnabled(configured),
    mapServerError,
  });
  useRegisterGroupedEditor(editor, { enabled: !readOnly });

  const {
    control,
    register,
    setValue,
    watch,
    clearErrors,
    formState: { errors },
  } = editor.form;

  const selectedProvider = watch('providerSlug');

  // See `modelRowShape` for the shapes the Model row takes.
  const modelValue = watch('model');
  const providerCatalog = embeddingCatalogs.get(selectedProvider);
  const shape = shapeOf(selectedProvider);
  const catalogModels = providerCatalog?.models ?? EMPTY_CATALOG_MODELS;
  // The free tag field behind "Other model…" — only where the listing may
  // be incomplete; on a closed select a stored tag the catalog does not list
  // shows as its own entry instead, so the admin sees what is configured
  // and can move it onto a listed model.
  const allowCustom = shape.kind === 'pick' && shape.allowCustom;
  const customModel = allowCustom && watch('modelSource') === 'custom';
  const modelOptions = useMemo(() => {
    const listed = catalogModels.map((entry) => ({
      value: entry.id,
      label: entry.id,
    }));
    const stray =
      modelValue !== '' &&
      !customModel &&
      !catalogModels.some((entry) => entry.id === modelValue)
        ? [{ value: modelValue, label: modelValue }]
        : [];
    return [
      ...listed,
      ...stray,
      ...(allowCustom
        ? [
            {
              value: CUSTOM_MODEL,
              label: t('dataResidency.orgEmbedding.modelCustom'),
            },
          ]
        : []),
    ];
  }, [allowCustom, catalogModels, customModel, modelValue, t]);

  const onPickModel = useCallback(
    (value: string) => {
      if (value === CUSTOM_MODEL) {
        setValue('modelSource', 'custom', { shouldDirty: true });
        // The tag field opens empty and unjudged — a "required" error under
        // a field the admin has not typed into yet is noise.
        setValue('model', '', { shouldDirty: true });
        clearErrors('model');
        return;
      }
      setValue('modelSource', 'catalog', { shouldDirty: true });
      setValue('model', value, { shouldDirty: true, shouldValidate: true });
      // The width is the one fact nobody should look up by hand; a pick
      // that carries it fills the field, a pick without one leaves the
      // admin's own figure alone.
      const width = catalogModels.find(
        (entry) => entry.id === value,
      )?.dimensions;
      if (width !== undefined) {
        setValue('dimensions', String(width), {
          shouldDirty: true,
          shouldValidate: true,
        });
      }
    },
    [catalogModels, clearErrors, setValue],
  );

  // What the row's hint may claim follows the shape: only a declaration says
  // "cannot embed", and a free field says "no curated width" only once the
  // listing and the declarations have answered — an unanswered declarations
  // read is `unchecked`, never free, and a failed listing proves no width
  // missing. Before a provider is chosen, or after the listing failed, the
  // row keeps the neutral spelling hint.
  const modelRowHint = isRefusal(shape)
    ? t(REFUSAL_COPY[shape.kind].hint, { provider: selectedProvider })
    : shape.kind === 'free'
      ? baselineSettled && !catalogsReadFailed && selectedProvider !== ''
        ? t('dataResidency.orgEmbedding.modelUncuratedHint', {
            provider: selectedProvider,
          })
        : t('dataResidency.orgEmbedding.modelHint')
      : !shape.allowCustom
        ? t('dataResidency.orgEmbedding.modelCatalogHint')
        : customModel
          ? t('dataResidency.orgEmbedding.modelHint')
          : t('dataResidency.orgEmbedding.modelCatalogCustomHint');

  // Provider options: every provider the org holds a credential for, plus the
  // stored value itself (so a config whose credential set changed still shows
  // what it points at instead of a blank select).
  const providerOptions = useMemo(() => {
    const slugs = new Set(credentials.map((c) => c.providerSlug));
    if (selectedProvider) slugs.add(selectedProvider);
    return [...slugs]
      .sort((a, b) => a.localeCompare(b))
      .map((slug) => ({ value: slug, label: slug }));
  }, [credentials, selectedProvider]);

  const credentialOptions = useMemo(() => {
    const own = credentials
      .filter((c) => c.providerSlug === selectedProvider)
      .map((c) => ({ value: c.id, label: c.name }));
    return [
      {
        value: DEFAULT_CREDENTIAL,
        label: t('dataResidency.orgEmbedding.credentialDefault'),
      },
      ...own,
    ];
  }, [credentials, selectedProvider, t]);

  async function onRemove() {
    try {
      await remove.mutateAsync({ organizationId });
      toast({ description: t('dataResidency.orgEmbedding.removed') });
    } catch (err) {
      toast({
        variant: 'destructive',
        description: mapOrgResidencyError(err, t),
      });
    } finally {
      setRemoveConfirmOpen(false);
    }
  }

  // A curated pick from the catalogs the org's credentials already unlock —
  // it FILLS the form (the lookup nobody should do by hand is the vector
  // width); committing stays with the unified Save, like every other field.
  // Offered only while nothing is configured.
  const recommendation = recommendationsQuery.data?.recommendations[0];
  const applyRecommendation = useCallback(() => {
    if (recommendation === undefined) return;
    setEnabled(true);
    setValue('providerSlug', recommendation.providerSlug, {
      shouldDirty: true,
      shouldValidate: true,
    });
    setValue('credentialId', DEFAULT_CREDENTIAL, { shouldDirty: true });
    setValue('model', recommendation.model, {
      shouldDirty: true,
      shouldValidate: true,
    });
    // A recommendation is a catalog entry by construction (only curated
    // entries carry a width), so the select shows it as such.
    setValue('modelSource', 'catalog', { shouldDirty: true });
    setValue('dimensions', String(recommendation.dimensions), {
      shouldDirty: true,
      shouldValidate: true,
    });
  }, [recommendation, setValue]);

  const recommendationAlert =
    !configured && recommendation !== undefined ? (
      <Alert
        variant="info"
        description={
          <HStack gap={3} align="center" className="flex-wrap">
            <span>
              {t('dataResidency.orgEmbedding.recommendationBody', {
                model: recommendation.model,
                provider: recommendation.providerSlug,
                dimensions: recommendation.dimensions,
              })}
            </span>
            <Button size="sm" variant="secondary" onClick={applyRecommendation}>
              {t('dataResidency.orgEmbedding.recommendationApply')}
            </Button>
          </HStack>
        }
      />
    ) : null;

  function onToggle(checked: boolean) {
    if (checked) {
      setEnabled(true);
      return;
    }
    if (configured) {
      setRemoveConfirmOpen(true);
      return;
    }
    // `onReset` collapses the panel: nothing is saved, so `configured` is off.
    editor.reset();
  }

  // Unlike the sibling toggles, the badge tracks the PERSISTED state, not the
  // reveal state: a just-opened empty form is not "Configured".
  // Settings whose credential is gone are not "Configured": indexing and
  // search are down until a key is restored or another one chosen.
  const credentialMissing = configured && view?.credentialResolvable === false;
  const statusBadge = credentialMissing ? (
    <Badge variant="orange" dot>
      {t('dataResidency.orgEmbedding.statusCredentialMissing')}
    </Badge>
  ) : (
    <StatusBadge
      enabled={configured}
      onLabel={t('dataResidency.orgEmbedding.statusConfigured')}
      offLabel={t('dataResidency.orgEmbedding.statusNotConfigured')}
    />
  );

  return (
    <SettingsSection
      title={t('dataResidency.orgEmbedding.title')}
      description={t('dataResidency.orgEmbedding.description')}
      action={
        readError ? undefined : readOnly ? (
          statusBadge
        ) : (
          <HStack gap={2} align="center">
            {statusBadge}
            <Switch
              aria-label={t('dataResidency.orgEmbedding.title')}
              checked={enabled}
              disabled={remove.isPending}
              onCheckedChange={onToggle}
            />
          </HStack>
        )
      }
    >
      {readError ? (
        <Alert
          variant="warning"
          description={t('dataResidency.orgEmbedding.errors.readFailed', {
            error: readError,
          })}
        />
      ) : readOnly ? (
        <>
          <Alert
            variant="info"
            description={
              <>
                <strong>{t('dataResidency.readOnly.title')}</strong>{' '}
                {t('dataResidency.orgEmbedding.readOnlyBody')}
              </>
            }
          />
          {configured ? (
            <SettingsFieldList>
              <SettingsFieldRow
                label={t('dataResidency.orgEmbedding.provider')}
              >
                <Input
                  aria-label={t('dataResidency.orgEmbedding.provider')}
                  value={view?.providerSlug || READ_ONLY_EMPTY}
                  readOnly
                />
              </SettingsFieldRow>
              <SettingsFieldRow label={t('dataResidency.orgEmbedding.model')}>
                <Input
                  aria-label={t('dataResidency.orgEmbedding.model')}
                  value={view?.model || READ_ONLY_EMPTY}
                  readOnly
                />
              </SettingsFieldRow>
              <SettingsFieldRow
                label={t('dataResidency.orgEmbedding.dimensions')}
              >
                <Input
                  aria-label={t('dataResidency.orgEmbedding.dimensions')}
                  value={
                    view?.dimensions === undefined
                      ? READ_ONLY_EMPTY
                      : String(view.dimensions)
                  }
                  readOnly
                />
              </SettingsFieldRow>
            </SettingsFieldList>
          ) : null}
        </>
      ) : !enabled ? (
        // Collapsed ≠ fine here: with no embedding model, knowledge search
        // refuses — the consequence stays visible while the form is hidden,
        // unlike the sibling sections whose "off" is a working default. The
        // recommendation rides right under it: the fix, one click away.
        !configured ? (
          <Stack gap={3}>
            <Alert
              variant="warning"
              description={t('dataResidency.orgEmbedding.notConfiguredWarning')}
            />
            {recommendationAlert}
          </Stack>
        ) : credentialMissing ? (
          <Alert
            variant="warning"
            description={t(
              'dataResidency.orgEmbedding.credentialMissingWarning',
            )}
          />
        ) : null
      ) : (
        <Stack gap={5}>
          {!configured ? (
            <Alert
              variant="warning"
              description={t('dataResidency.orgEmbedding.notConfiguredWarning')}
            />
          ) : credentialMissing ? (
            <Alert
              variant="warning"
              description={t(
                'dataResidency.orgEmbedding.credentialMissingWarning',
              )}
            />
          ) : null}
          {supportReadFailed ? (
            <Alert
              variant="warning"
              description={
                <HStack gap={3} align="center" className="flex-wrap">
                  <span>
                    {t('dataResidency.orgEmbedding.supportReadFailed')}
                  </span>
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={recommendationsQuery.isFetching}
                    onClick={() => void recommendationsQuery.refetch()}
                  >
                    {t('dataResidency.orgEmbedding.supportReadRetry')}
                  </Button>
                </HStack>
              }
            />
          ) : null}
          {recommendationAlert}
          {credentialsQuery.data !== undefined && credentials.length === 0 ? (
            <Alert
              variant="info"
              description={t('dataResidency.orgEmbedding.noCredentials')}
            />
          ) : null}
          <form id={FORM_ID} onSubmit={editor.submit}>
            {/* The selects repeat the fieldset's `disabled`: a disabled
                fieldset keeps a click off its buttons but not the pointer
                events a popup select opens on, so an admin could pick a
                provider before the form knows which ones cannot embed. */}
            <fieldset disabled={editor.isLoading} className="contents">
              <SettingsFieldList>
                <SettingsFieldRow
                  label={t('dataResidency.orgEmbedding.provider')}
                  required
                >
                  <Controller
                    control={control}
                    name="providerSlug"
                    render={({ field }) => (
                      <Select
                        aria-label={t('dataResidency.orgEmbedding.provider')}
                        disabled={editor.isLoading}
                        value={field.value}
                        onValueChange={(v) => {
                          field.onChange(v);
                          // A credential belongs to one provider; switching
                          // providers resets the pick to the new provider's
                          // default rather than carrying a mismatched id.
                          setValue('credentialId', DEFAULT_CREDENTIAL, {
                            shouldDirty: true,
                          });
                          // So does a model tag — it names one provider's
                          // model, so the pick starts over from the new
                          // provider's catalog. And the width with it: it
                          // is that model's, and a pick from the catalog
                          // states it again.
                          setValue('model', '', { shouldDirty: true });
                          setValue('modelSource', 'catalog', {
                            shouldDirty: true,
                          });
                          setValue('dimensions', '', { shouldDirty: true });
                        }}
                        options={providerOptions}
                        placeholder={t(
                          'dataResidency.orgEmbedding.providerPlaceholder',
                        )}
                        emptyHint={t(
                          'dataResidency.orgEmbedding.noCredentials',
                        )}
                        errorMessage={errors.providerSlug?.message}
                      />
                    )}
                  />
                </SettingsFieldRow>
                <SettingsFieldRow
                  label={t('dataResidency.orgEmbedding.credential')}
                  description={t('dataResidency.orgEmbedding.credentialHint')}
                >
                  <Controller
                    control={control}
                    name="credentialId"
                    render={({ field }) => (
                      <Select
                        aria-label={t('dataResidency.orgEmbedding.credential')}
                        disabled={editor.isLoading}
                        value={field.value}
                        onValueChange={field.onChange}
                        options={credentialOptions}
                        errorMessage={errors.credentialId?.message}
                      />
                    )}
                  />
                </SettingsFieldRow>
                <SettingsFieldRow
                  label={t('dataResidency.orgEmbedding.model')}
                  description={modelRowHint}
                  required
                >
                  {shape.kind === 'pick' ? (
                    <Stack gap={2}>
                      <Select
                        aria-label={t('dataResidency.orgEmbedding.model')}
                        disabled={editor.isLoading}
                        value={customModel ? CUSTOM_MODEL : modelValue}
                        onValueChange={onPickModel}
                        options={modelOptions}
                        placeholder={t(
                          'dataResidency.orgEmbedding.modelPlaceholder',
                        )}
                        errorMessage={
                          customModel ? undefined : errors.model?.message
                        }
                      />
                      {customModel ? (
                        <Input
                          aria-label={t('dataResidency.orgEmbedding.modelTag')}
                          placeholder="text-embedding-3-small"
                          wrapperClassName="w-full"
                          errorMessage={errors.model?.message}
                          {...register('model')}
                        />
                      ) : null}
                    </Stack>
                  ) : shape.kind === 'free' ? (
                    <Input
                      aria-label={t('dataResidency.orgEmbedding.model')}
                      placeholder="text-embedding-3-small"
                      wrapperClassName="w-full"
                      errorMessage={errors.model?.message}
                      {...register('model')}
                    />
                  ) : (
                    // Refused: nothing to type into. A tag stored before the
                    // refusal stays visible so the admin knows what the
                    // config still names.
                    <Stack gap={2}>
                      {modelValue !== '' ? (
                        <Input
                          aria-label={t('dataResidency.orgEmbedding.model')}
                          wrapperClassName="w-full"
                          value={modelValue}
                          readOnly
                        />
                      ) : null}
                      <Text role="status" variant="muted" className="text-sm">
                        {t(REFUSAL_COPY[shape.kind].label)}
                      </Text>
                    </Stack>
                  )}
                </SettingsFieldRow>
                <SettingsFieldRow
                  label={t('dataResidency.orgEmbedding.dimensions')}
                  description={t('dataResidency.orgEmbedding.dimensionsHint', {
                    widths: VECTOR_WIDTHS,
                  })}
                  required
                >
                  <Input
                    aria-label={t('dataResidency.orgEmbedding.dimensions')}
                    type="number"
                    min={KNOWLEDGE_VECTOR_WIDTHS[0]}
                    max={KNOWLEDGE_VECTOR_WIDTHS.at(-1)}
                    step={1}
                    placeholder="1536"
                    wrapperClassName="w-full"
                    errorMessage={errors.dimensions?.message}
                    {...register('dimensions')}
                  />
                </SettingsFieldRow>
                <SettingsFieldRow
                  label={t('dataResidency.orgEmbedding.baseUrl')}
                  description={t('dataResidency.orgEmbedding.baseUrlHint')}
                >
                  <Input
                    aria-label={t('dataResidency.orgEmbedding.baseUrl')}
                    placeholder="https://api.example.com/v1"
                    wrapperClassName="w-full"
                    errorMessage={errors.baseUrl?.message}
                    {...register('baseUrl')}
                  />
                </SettingsFieldRow>
              </SettingsFieldList>
            </fieldset>
          </form>
        </Stack>
      )}

      <ConfirmDialog
        open={removeConfirmOpen}
        onOpenChange={setRemoveConfirmOpen}
        title={t('dataResidency.orgEmbedding.removeConfirm.title')}
        description={t('dataResidency.orgEmbedding.removeConfirm.description')}
        confirmText={t('dataResidency.orgEmbedding.removeConfirm.confirm')}
        isLoading={remove.isPending}
        variant="destructive"
        onConfirm={() => void onRemove()}
      />
    </SettingsSection>
  );
}
