'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { providerBaseUrlSchema } from '@tale/shared/schemas/providers';
import { Alert } from '@tale/ui/alert';
import { Checkbox } from '@tale/ui/checkbox';
import { CheckboxGroup } from '@tale/ui/checkbox-group';
import { CollapsibleDetails } from '@tale/ui/collapsible-details';
import { FormDialog } from '@tale/ui/dialog/form-dialog';
import { FormSection } from '@tale/ui/form-section';
import { Input } from '@tale/ui/input';
import { Stack } from '@tale/ui/layout';
import { RadioGroup } from '@tale/ui/radio-group';
import { Select } from '@tale/ui/select';
import { useForm } from '@tale/ui/use-form';
import { useToast } from '@tale/ui/use-toast';
import { useEffect, useMemo, useState } from 'react';
import { Controller } from 'react-hook-form';
import * as z from 'zod';

import { useT } from '@/lib/i18n/client';

import { useSaveProviderDefinition } from '../hooks/mutations';
import { useProviderDefinition } from '../hooks/queries';
import { apiFormatLabel, authMethodLabel } from '../labels';
import {
  buildProviderDefinition,
  emptyProviderDefinitionForm,
  mapProviderDefinitionError,
  OFFERED_AUTH_METHODS,
  OFFERED_CATALOG_SOURCES,
  providerDefinitionToForm,
  slugifyProviderName,
  type ProviderDefinitionFormValues,
} from './provider-definition-form';

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const API_FORMATS = ['openai', 'anthropic'] as const;

export type ProviderDefinitionDialogMode =
  | { kind: 'create' }
  | { kind: 'edit'; name: string };

/**
 * Define or edit one of the organization's custom providers — the connector
 * for an endpoint it runs or subscribes to (a vLLM or Ollama box, an internal
 * gateway). Credentials for it are added separately, through the credential
 * table above the section.
 *
 * Create and edit share the form; only the identifier differs, since it is
 * the definition's file name: suggested from the display name until the
 * reader types one, and read-only once the definition exists. An edit reads
 * the definition fresh on open — the hash it returns is what the save names,
 * so the backend can refuse a save over a definition somebody else changed.
 */
export function ProviderDefinitionDialog({
  organizationId,
  mode,
  takenNames,
  open,
  onOpenChange,
}: {
  organizationId: string;
  mode: ProviderDefinitionDialogMode;
  /** Every provider key the organization can already see — shipped or its
   * own — so a new identifier is refused before the request goes out. */
  takenNames: ReadonlySet<string>;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useT('settings');
  const { toast } = useToast();
  const save = useSaveProviderDefinition(organizationId);
  const isCreate = mode.kind === 'create';
  const definition = useProviderDefinition(
    organizationId,
    mode.kind === 'edit' ? mode.name : '',
    { enabled: open && mode.kind === 'edit' },
  );
  const existing = definition.data?.config ?? undefined;

  const [error, setError] = useState<string | null>(null);
  // Once the reader has typed an identifier, the display name stops
  // suggesting one — their spelling wins.
  const [nameEdited, setNameEdited] = useState(false);

  const schema = useMemo(
    () =>
      z
        .object({
          displayName: z
            .string()
            .trim()
            .min(1, t('providers.custom.dialog.displayNameRequired'))
            .max(200),
          name: z
            .string()
            .trim()
            .max(64)
            .regex(SLUG, t('providers.custom.dialog.nameInvalid'))
            .refine(
              (value) => !isCreate || !takenNames.has(value),
              t('providers.custom.dialog.nameTaken'),
            ),
          apiFormat: z.enum(API_FORMATS),
          baseUrl: z.string().trim(),
          catalogSource: z.enum([
            'models-endpoint',
            'none',
            'static',
            'openrouter-api',
          ]),
          authMethods: z
            .array(z.string())
            .min(1, t('providers.custom.dialog.authMethodsRequired')),
          modernOpenAiWire: z.boolean(),
          perCredentialEndpoint: z.boolean(),
          harnessEndpointUrl: z.string().trim(),
          harnessEndpointFormat: z.enum(API_FORMATS),
        })
        .superRefine((values, ctx) => {
          if (values.baseUrl.length === 0) {
            if (!values.perCredentialEndpoint) {
              ctx.addIssue({
                code: 'custom',
                path: ['baseUrl'],
                message: t('providers.custom.dialog.baseUrlRequired'),
              });
            }
          } else if (!providerBaseUrlSchema.safeParse(values.baseUrl).success) {
            ctx.addIssue({
              code: 'custom',
              path: ['baseUrl'],
              message: t('providers.custom.dialog.urlInvalid'),
            });
          }
          if (
            values.harnessEndpointUrl.length > 0 &&
            !providerBaseUrlSchema.safeParse(values.harnessEndpointUrl).success
          ) {
            ctx.addIssue({
              code: 'custom',
              path: ['harnessEndpointUrl'],
              message: t('providers.custom.dialog.urlInvalid'),
            });
          }
        }),
    [isCreate, t, takenNames],
  );

  const form = useForm<ProviderDefinitionFormValues>({
    resolver: zodResolver(schema),
    defaultValues: emptyProviderDefinitionForm(),
  });
  const { register, control, handleSubmit, formState, reset, setValue, watch } =
    form;

  // The loaded definition becomes the form once — not over the reader's
  // edits when a background refetch lands.
  useEffect(() => {
    if (!open || isCreate || existing === undefined || formState.isDirty)
      return;
    reset(providerDefinitionToForm(existing));
  }, [existing, formState.isDirty, isCreate, open, reset]);

  const displayName = watch('displayName');
  useEffect(() => {
    if (!isCreate || nameEdited) return;
    setValue('name', slugifyProviderName(displayName), {
      shouldValidate: displayName.length > 0,
    });
  }, [displayName, isCreate, nameEdited, setValue]);

  const apiFormat = watch('apiFormat');
  const catalogSource = watch('catalogSource');
  const perCredentialEndpoint = watch('perCredentialEndpoint');
  const harnessEndpointUrl = watch('harnessEndpointUrl');

  const loading = !isCreate && definition.isPending;
  const gone = !isCreate && definition.data?.config === null;
  const busy = save.isPending || loading;

  const catalogOptions = useMemo(() => {
    const offered = OFFERED_CATALOG_SOURCES.map((source) => ({
      value: source,
      label:
        source === 'models-endpoint'
          ? t('providers.custom.dialog.catalogModelsEndpoint')
          : t('providers.custom.dialog.catalogNone'),
    }));
    // A hand-written file may use a source the form does not offer; show it
    // rather than silently moving the definition to another one.
    if ((OFFERED_CATALOG_SOURCES as readonly string[]).includes(catalogSource))
      return offered;
    return [
      ...offered,
      {
        value: catalogSource,
        label:
          catalogSource === 'static'
            ? t('providers.custom.dialog.catalogStatic')
            : t('providers.custom.dialog.catalogOpenrouter'),
      },
    ];
  }, [catalogSource, t]);

  const close = () => {
    reset(emptyProviderDefinitionForm());
    setNameEdited(false);
    setError(null);
    onOpenChange(false);
  };

  const onSubmit = handleSubmit(async (values) => {
    if (busy || gone) return;
    setError(null);
    const built = buildProviderDefinition(values, existing);
    if (!built.ok) {
      setError(t('providers.custom.dialog.invalid', { error: built.message }));
      return;
    }
    try {
      await save.mutateAsync({
        organizationId,
        name: built.config.name,
        config: built.config,
        expectedHash: isCreate ? null : (definition.data?.hash ?? null),
      });
      toast({
        title: isCreate
          ? t('providers.custom.createdToast')
          : t('providers.custom.savedToast'),
      });
      close();
    } catch (err) {
      console.error('providers: save custom provider failed', err);
      setError(mapProviderDefinitionError(t, err));
    }
  });

  return (
    <FormDialog
      open={open}
      onOpenChange={(next) => {
        if (next) onOpenChange(true);
        else if (!save.isPending) close();
      }}
      title={
        isCreate
          ? t('providers.custom.dialog.createTitle')
          : t('providers.custom.dialog.editTitle')
      }
      description={t('providers.custom.dialog.description')}
      isSubmitting={save.isPending}
      isDirty={formState.isDirty}
      isValid={formState.isValid && !loading && !gone}
      confirmDiscardOnDirty
      onSubmit={(e) => void onSubmit(e)}
      submitText={
        isCreate
          ? t('providers.custom.dialog.submitCreate')
          : t('providers.custom.dialog.submitEdit')
      }
      large
    >
      <FormSection>
        {error !== null && <Alert variant="destructive" description={error} />}
        {!isCreate && definition.isError && (
          <Alert
            variant="destructive"
            description={t('providers.custom.dialog.loadFailed')}
          />
        )}
        {gone && (
          <Alert
            variant="warning"
            description={t('providers.custom.dialog.gone')}
          />
        )}
        <Input
          label={t('providers.custom.dialog.displayName')}
          placeholder={t('providers.custom.dialog.displayNamePlaceholder')}
          maxLength={200}
          required
          disabled={busy}
          {...register('displayName')}
          errorMessage={formState.errors.displayName?.message}
        />
        <Input
          label={t('providers.custom.dialog.name')}
          placeholder="internal-vllm"
          maxLength={64}
          required
          description={
            isCreate
              ? t('providers.custom.dialog.nameHelp')
              : t('providers.custom.dialog.nameLocked')
          }
          disabled={busy || !isCreate}
          {...register('name', { onChange: () => setNameEdited(true) })}
          errorMessage={formState.errors.name?.message}
        />
        <Controller
          control={control}
          name="apiFormat"
          render={({ field }) => (
            <RadioGroup
              label={t('providers.custom.dialog.apiFormat')}
              value={field.value}
              onValueChange={field.onChange}
              disabled={busy}
              options={[
                {
                  value: 'openai',
                  label: apiFormatLabel(t, 'openai'),
                  description: t('providers.custom.dialog.apiFormatOpenaiHelp'),
                },
                {
                  value: 'anthropic',
                  label: apiFormatLabel(t, 'anthropic'),
                  description: t(
                    'providers.custom.dialog.apiFormatAnthropicHelp',
                  ),
                },
              ]}
            />
          )}
        />
        <Input
          label={t('providers.custom.dialog.baseUrl')}
          placeholder="https://models.example.com/v1"
          inputMode="url"
          autoComplete="off"
          required={!perCredentialEndpoint}
          description={t('providers.custom.dialog.baseUrlHelp')}
          disabled={busy}
          {...register('baseUrl')}
          errorMessage={formState.errors.baseUrl?.message}
        />
        <Controller
          control={control}
          name="catalogSource"
          render={({ field }) => (
            <Select
              label={t('providers.custom.dialog.catalog')}
              value={field.value}
              onValueChange={field.onChange}
              options={catalogOptions}
              description={t('providers.custom.dialog.catalogHelp')}
              disabled={busy}
            />
          )}
        />
        <Controller
          control={control}
          name="authMethods"
          render={({ field, fieldState }) => (
            <CheckboxGroup
              label={t('providers.custom.dialog.authMethods')}
              description={
                fieldState.error?.message !== undefined ? (
                  <span className="text-destructive">
                    {fieldState.error.message}
                  </span>
                ) : (
                  t('providers.custom.dialog.authMethodsHelp')
                )
              }
              options={OFFERED_AUTH_METHODS.map((method) => ({
                value: method,
                label: authMethodLabel(t, method),
              }))}
              value={field.value}
              onValueChange={field.onChange}
              disabled={busy}
              columns={1}
              required
            />
          )}
        />
        <CollapsibleDetails summary={t('providers.custom.dialog.advanced')}>
          <Stack gap={4} className="pt-3 pl-5">
            {apiFormat === 'openai' && (
              <Controller
                control={control}
                name="modernOpenAiWire"
                render={({ field }) => (
                  <Checkbox
                    label={t('providers.custom.dialog.wireDialect')}
                    description={t('providers.custom.dialog.wireDialectHelp')}
                    checked={field.value}
                    onCheckedChange={(checked) =>
                      field.onChange(checked === true)
                    }
                    disabled={busy}
                  />
                )}
              />
            )}
            <Controller
              control={control}
              name="perCredentialEndpoint"
              render={({ field }) => (
                <Checkbox
                  label={t('providers.custom.dialog.perCredential')}
                  description={t('providers.custom.dialog.perCredentialHelp')}
                  checked={field.value}
                  onCheckedChange={(checked) =>
                    field.onChange(checked === true)
                  }
                  disabled={busy}
                />
              )}
            />
            <Input
              label={t('providers.custom.dialog.harnessEndpoint')}
              placeholder="https://models.example.com/anthropic"
              inputMode="url"
              autoComplete="off"
              description={t('providers.custom.dialog.harnessEndpointHelp')}
              disabled={busy}
              {...register('harnessEndpointUrl')}
              errorMessage={formState.errors.harnessEndpointUrl?.message}
            />
            <Controller
              control={control}
              name="harnessEndpointFormat"
              render={({ field }) => (
                <Select
                  label={t('providers.custom.dialog.harnessEndpointFormat')}
                  value={field.value}
                  onValueChange={field.onChange}
                  options={API_FORMATS.map((format) => ({
                    value: format,
                    label: apiFormatLabel(t, format),
                  }))}
                  disabled={busy || harnessEndpointUrl.trim().length === 0}
                />
              )}
            />
          </Stack>
        </CollapsibleDetails>
      </FormSection>
    </FormDialog>
  );
}
