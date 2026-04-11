'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { Info, Plus, Trash2 } from 'lucide-react';
import { useCallback, useMemo } from 'react';
import { useFieldArray, useForm } from 'react-hook-form';
import { z } from 'zod/v4';

import { FormDialog } from '@/app/components/ui/dialog/form-dialog';
import { Checkbox } from '@/app/components/ui/forms/checkbox';
import { Input } from '@/app/components/ui/forms/input';
import { HStack, Stack } from '@/app/components/ui/layout/layout';
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

interface ProviderAddDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organizationId: string;
}

export function ProviderAddDialog({
  open,
  onOpenChange,
  organizationId: _organizationId,
}: ProviderAddDialogProps) {
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
        baseUrl: z.string().url(
          tCommon('validation.required', {
            field: t('providers.baseUrl'),
          }),
        ),
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
    <FormDialog
      open={open}
      onOpenChange={(isOpen) => {
        if (!isOpen) reset();
        onOpenChange(isOpen);
      }}
      title={t('providers.addProvider')}
      submitText={t('providers.addProvider')}
      submittingText={tCommon('actions.adding')}
      isSubmitting={isSubmitting}
      isValid={isValid}
      onSubmit={handleSubmit(onSubmit)}
      large
    >
      <Stack gap={4}>
        <div className="bg-muted/50 flex items-start gap-2.5 rounded-lg border p-3">
          <Info className="text-muted-foreground mt-0.5 size-4 shrink-0" />
          <Text variant="caption" className="text-muted-foreground text-[13px]">
            {t('providers.byomGuidance')}
          </Text>
        </div>

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
            <Text className="text-sm font-medium">{t('providers.models')}</Text>
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
            <Text variant="caption" className="text-destructive text-sm">
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
                  errorMessage={errors.models?.[index]?.displayName?.message}
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
                            watchedModels[index]?.tags?.includes(tag) ?? false
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
    </FormDialog>
  );
}
