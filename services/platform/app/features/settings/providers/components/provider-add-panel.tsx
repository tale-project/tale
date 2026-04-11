'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { Loader2, Plus, Trash2, X } from 'lucide-react';
import { useCallback, useMemo } from 'react';
import { useFieldArray, useForm } from 'react-hook-form';
import { z } from 'zod/v4';

import { CollapsibleGuide } from '@/app/components/ui/data-display/collapsible-guide';
import { Checkbox } from '@/app/components/ui/forms/checkbox';
import { Input } from '@/app/components/ui/forms/input';
import { HStack, Stack } from '@/app/components/ui/layout/layout';
import { Sheet } from '@/app/components/ui/overlays/sheet';
import { Button } from '@/app/components/ui/primitives/button';
import { IconButton } from '@/app/components/ui/primitives/icon-button';
import { Text } from '@/app/components/ui/typography/text';
import { toast } from '@/app/hooks/use-toast';
import { useT } from '@/lib/i18n/client';

import { useSaveProvider, useSaveProviderSecret } from '../hooks/mutations';

const modelTagLiterals = ['chat', 'vision', 'embedding'] as const;

type FormData = {
  name: string;
  displayName: string;
  baseUrl: string;
  apiKey: string;
  models: Array<{
    id: string;
    displayName: string;
    tags: Array<(typeof modelTagLiterals)[number]>;
  }>;
};

interface ProviderAddPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organizationId: string;
}

export function ProviderAddPanel({
  open,
  onOpenChange,
  organizationId: _organizationId,
}: ProviderAddPanelProps) {
  const { t } = useT('settings');
  const { t: tCommon } = useT('common');
  const { mutateAsync: saveProvider } = useSaveProvider();
  const { mutateAsync: saveProviderSecret } = useSaveProviderSecret();

  const formSchema = useMemo(
    () =>
      z.object({
        name: z
          .string()
          .min(
            1,
            tCommon('validation.required', {
              field: t('providers.name'),
            }),
          )
          .regex(/^[a-z][a-z0-9-]*$/, t('providers.namePatternError')),
        displayName: z.string().min(
          1,
          tCommon('validation.required', {
            field: t('providers.displayName'),
          }),
        ),
        baseUrl: z
          .string()
          .min(
            1,
            tCommon('validation.required', {
              field: t('providers.baseUrl'),
            }),
          )
          .url(tCommon('validation.url')),
        apiKey: z.string().min(
          1,
          tCommon('validation.required', {
            field: t('providers.apiKey'),
          }),
        ),
        models: z
          .array(
            z.object({
              id: z.string().min(1, t('providers.modelIdRequired')),
              displayName: z
                .string()
                .min(1, t('providers.displayNameRequired')),
              tags: z
                .array(z.enum(modelTagLiterals))
                .min(1, t('providers.tagsRequired')),
            }),
          )
          .min(1, t('providers.modelsRequired'))
          .superRefine((models, ctx) => {
            const seen = new Set<string>();
            for (let i = 0; i < models.length; i++) {
              const id = models[i].id;
              if (id && seen.has(id)) {
                ctx.addIssue({
                  code: 'custom',
                  message: t('providers.duplicateModelId'),
                  path: [i, 'id'],
                });
              }
              seen.add(id);
            }
          }),
      }),
    [t, tCommon],
  );

  const {
    register,
    control,
    handleSubmit,
    formState: { isSubmitting, isValid, errors },
    reset,
    setValue,
    watch,
  } = useForm<FormData>({
    resolver: zodResolver(formSchema),
    mode: 'onChange',
    defaultValues: {
      name: '',
      displayName: '',
      baseUrl: '',
      apiKey: '',
      models: [{ id: '', displayName: '', tags: ['chat'] }],
    },
  });

  const { fields, append, remove } = useFieldArray({
    control,
    name: 'models',
  });

  const watchedModels = watch('models');

  const handleTagToggle = useCallback(
    (
      modelIndex: number,
      tag: (typeof modelTagLiterals)[number],
      checked: boolean,
    ) => {
      const current = watchedModels[modelIndex]?.tags ?? [];
      const next = checked
        ? [...current, tag]
        : current.filter((v) => v !== tag);
      setValue(`models.${modelIndex}.tags`, next, { shouldValidate: true });
    },
    [watchedModels, setValue],
  );

  const handleOpenChange = useCallback(
    (isOpen: boolean) => {
      if (!isOpen) reset();
      onOpenChange(isOpen);
    },
    [reset, onOpenChange],
  );

  const onSubmit = async (data: FormData) => {
    try {
      await saveProvider({
        orgSlug: 'default',
        providerName: data.name,
        config: {
          displayName: data.displayName,
          baseUrl: data.baseUrl,
          models: data.models.map((m) => ({
            id: m.id,
            displayName: m.displayName,
            tags: m.tags,
          })),
        },
      });
      await saveProviderSecret({
        orgSlug: 'default',
        providerName: data.name,
        apiKey: data.apiKey,
      });
      toast({
        title: t('providers.created'),
        variant: 'success',
      });
      reset();
      onOpenChange(false);
    } catch (error) {
      console.error(error);
      toast({
        title: t('providers.createFailed'),
        variant: 'destructive',
      });
    }
  };

  return (
    <Sheet
      open={open}
      onOpenChange={handleOpenChange}
      title={t('providers.addProvider')}
      size="md"
      hideClose
      className="flex flex-col gap-0 p-0"
    >
      <HStack
        justify="between"
        align="center"
        className="border-border shrink-0 border-b p-4 sm:px-6 sm:py-4"
      >
        <Text variant="label" className="text-base font-semibold">
          {t('providers.addProvider')}
        </Text>
        <IconButton
          icon={X}
          aria-label={tCommon('aria.close')}
          variant="ghost"
          onClick={() => handleOpenChange(false)}
        />
      </HStack>

      <form
        onSubmit={handleSubmit(onSubmit)}
        className="flex min-h-0 flex-1 flex-col"
      >
        <div className="flex-1 overflow-y-auto p-4 sm:px-6 sm:py-5">
          <Stack gap={4}>
            <CollapsibleGuide
              label={t('providers.byomGuidanceTitle')}
              content={t('providers.byomGuidance')}
              defaultOpen
            />

            <Input
              id="name"
              label={t('providers.name')}
              {...register('name')}
              placeholder={t('providers.namePlaceholder')}
              errorMessage={errors.name?.message}
            />
            <Text variant="caption" className="-mt-2">
              {t('providers.nameHelp')}
            </Text>

            <Input
              id="displayName"
              label={t('providers.displayName')}
              {...register('displayName')}
              placeholder={t('providers.displayNamePlaceholder')}
              errorMessage={errors.displayName?.message}
            />

            <Input
              id="baseUrl"
              label={t('providers.baseUrl')}
              {...register('baseUrl')}
              placeholder={t('providers.baseUrlPlaceholder')}
              errorMessage={errors.baseUrl?.message}
            />

            <Input
              id="apiKey"
              label={t('providers.apiKey')}
              type="password"
              {...register('apiKey')}
              placeholder={t('providers.apiKeyPlaceholder')}
              errorMessage={errors.apiKey?.message}
              autoComplete="off"
            />

            <Stack gap={3}>
              <HStack justify="between" align="center">
                <Text className="text-sm font-medium">
                  {t('providers.models')}
                </Text>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() =>
                    append({ id: '', displayName: '', tags: ['chat'] })
                  }
                >
                  <Plus className="mr-1 size-3.5" />
                  {t('providers.addModel')}
                </Button>
              </HStack>

              {errors.models?.root?.message && (
                <Text
                  variant="caption"
                  className="text-destructive text-sm"
                  role="alert"
                >
                  {errors.models.root.message}
                </Text>
              )}

              {fields.map((field, index) => (
                <div key={field.id} className="rounded-lg border p-3">
                  <Stack gap={3}>
                    <HStack justify="between" align="center">
                      <Text variant="caption" className="font-medium">
                        {t('providers.modelNumber', { number: index + 1 })}
                      </Text>
                      {fields.length > 1 && (
                        <IconButton
                          type="button"
                          icon={Trash2}
                          aria-label={t('providers.removeModel')}
                          className="text-muted-foreground hover:text-destructive size-7"
                          onClick={() => remove(index)}
                        />
                      )}
                    </HStack>

                    <Input
                      id={`models.${index}.id`}
                      label={t('providers.modelId')}
                      {...register(`models.${index}.id`)}
                      placeholder={t('providers.modelIdPlaceholder')}
                      errorMessage={errors.models?.[index]?.id?.message}
                    />

                    <Input
                      id={`models.${index}.displayName`}
                      label={t('providers.displayName')}
                      {...register(`models.${index}.displayName`)}
                      placeholder={t('providers.modelDisplayNamePlaceholder')}
                      errorMessage={
                        errors.models?.[index]?.displayName?.message
                      }
                    />

                    <Stack gap={2}>
                      <Text variant="caption" className="text-sm font-medium">
                        {t('providers.tags')}
                      </Text>
                      <HStack gap={4} align="center" className="flex-wrap">
                        {modelTagLiterals.map((tag) => (
                          <label
                            key={tag}
                            className="flex items-center gap-1.5 text-sm"
                          >
                            <Checkbox
                              checked={
                                watchedModels[index]?.tags?.includes(tag) ??
                                false
                              }
                              onCheckedChange={(checked) =>
                                handleTagToggle(index, tag, checked === true)
                              }
                            />
                            {tag === 'chat'
                              ? t('providers.tagChat')
                              : tag === 'vision'
                                ? t('providers.tagVision')
                                : t('providers.tagEmbedding')}
                          </label>
                        ))}
                      </HStack>
                      {errors.models?.[index]?.tags?.message && (
                        <Text
                          variant="caption"
                          className="text-destructive text-sm"
                          role="alert"
                        >
                          {errors.models[index].tags.message}
                        </Text>
                      )}
                    </Stack>
                  </Stack>
                </div>
              ))}
            </Stack>
          </Stack>
        </div>

        <div className="border-border shrink-0 border-t p-4 sm:px-6 sm:py-4">
          <HStack justify="end" align="center">
            <Button type="submit" disabled={isSubmitting || !isValid}>
              {isSubmitting ? (
                <>
                  <Loader2 className="mr-2 size-4 animate-spin" />
                  {tCommon('actions.adding')}
                </>
              ) : (
                t('providers.addProvider')
              )}
            </Button>
          </HStack>
        </div>
      </form>
    </Sheet>
  );
}
