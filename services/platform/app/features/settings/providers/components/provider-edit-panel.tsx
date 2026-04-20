'use client';

import { Loader2, X } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

import { Input } from '@/app/components/ui/forms/input';
import { Select } from '@/app/components/ui/forms/select';
import { Textarea } from '@/app/components/ui/forms/textarea';
import { HStack, Stack } from '@/app/components/ui/layout/layout';
import { Sheet } from '@/app/components/ui/overlays/sheet';
import { Button } from '@/app/components/ui/primitives/button';
import { IconButton } from '@/app/components/ui/primitives/icon-button';
import { Text } from '@/app/components/ui/typography/text';
import { toast } from '@/app/hooks/use-toast';
import { useT } from '@/lib/i18n/client';

import { useSaveProvider } from '../hooks/mutations';
import { useReadProvider } from '../hooks/queries';
import { modelTagLabel } from '../utils/model-tag-label';

const NONE_VALUE = '__none__';

interface ProviderEditPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  providerName: string;
}

export function ProviderEditPanel({
  open,
  onOpenChange,
  providerName,
}: ProviderEditPanelProps) {
  const { t } = useT('settings');
  const { t: tCommon } = useT('common');
  const { data } = useReadProvider('default', providerName);
  const { mutateAsync: saveProvider, isPending } = useSaveProvider();

  const [form, setForm] = useState({
    name: '',
    displayName: '',
    description: '',
    baseUrl: '',
    defaults: {} as Record<string, string>,
  });

  useEffect(() => {
    if (data?.ok) {
      setForm({
        name: providerName,
        displayName: data.config.displayName,
        description: data.config.description ?? '',
        baseUrl: data.config.baseUrl,
        defaults: { ...data.config.defaults },
      });
    }
  }, [data, providerName]);

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!data?.ok) return;
      const cleanedDefaults = Object.fromEntries(
        Object.entries(form.defaults).filter(([, v]) => v && v !== NONE_VALUE),
      );
      try {
        await saveProvider({
          orgSlug: 'default',
          providerName,
          config: {
            ...data.config,
            displayName: form.displayName,
            description: form.description || undefined,
            baseUrl: form.baseUrl,
            defaults:
              Object.keys(cleanedDefaults).length > 0
                ? cleanedDefaults
                : undefined,
          },
        });
        toast({ title: t('providers.saved'), variant: 'success' });
        onOpenChange(false);
      } catch {
        toast({ title: t('providers.saveFailed'), variant: 'destructive' });
      }
    },
    [data, form, providerName, saveProvider, t, onOpenChange],
  );

  const isValid =
    form.displayName.trim().length > 0 &&
    form.baseUrl.trim().length > 0 &&
    URL.canParse(form.baseUrl.trim());

  const isDirty =
    data?.ok &&
    (form.displayName !== data.config.displayName ||
      form.description !== (data.config.description ?? '') ||
      form.baseUrl !== data.config.baseUrl ||
      form.defaults.chat !== (data.config.defaults?.chat ?? NONE_VALUE) ||
      form.defaults.vision !== (data.config.defaults?.vision ?? NONE_VALUE) ||
      form.defaults.embedding !==
        (data.config.defaults?.embedding ?? NONE_VALUE));

  const models = data?.ok ? data.config.models : [];

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={t('providers.editProvider')}
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
          {t('providers.editProvider')}
        </Text>
        <IconButton
          icon={X}
          aria-label={tCommon('aria.close')}
          variant="ghost"
          onClick={() => onOpenChange(false)}
        />
      </HStack>

      <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
        <div className="flex-1 overflow-y-auto p-4 sm:px-6 sm:py-5">
          <Stack gap={4}>
            <Input
              label={t('providers.name')}
              value={form.name}
              disabled
              readOnly
            />
            <Text variant="caption" className="text-muted-foreground -mt-2">
              {t('providers.nameReadonlyHelp')}
            </Text>

            <Input
              label={t('providers.displayName')}
              value={form.displayName}
              onChange={(e) =>
                setForm((f) => ({ ...f, displayName: e.target.value }))
              }
              placeholder={t('providers.displayNamePlaceholder')}
            />

            <Textarea
              label={t('providers.description_field')}
              value={form.description}
              onChange={(e) =>
                setForm((f) => ({ ...f, description: e.target.value }))
              }
              placeholder={t('providers.descriptionPlaceholder')}
              rows={3}
            />

            <Input
              label={t('providers.baseUrl')}
              value={form.baseUrl}
              onChange={(e) =>
                setForm((f) => ({ ...f, baseUrl: e.target.value }))
              }
              placeholder={t('providers.baseUrlPlaceholder')}
            />

            <div className="border-border border-t pt-4">
              <Text className="mb-3 text-sm font-semibold">
                {t('providers.defaultModels')}
              </Text>
              <Stack gap={4}>
                {(['chat', 'vision', 'embedding'] as const).map((tag) => {
                  const modelsWithTag = models.filter((m) =>
                    (m.tags as readonly string[]).includes(tag),
                  );
                  return (
                    <Select
                      key={tag}
                      label={modelTagLabel(tag, t)}
                      options={[
                        {
                          value: NONE_VALUE,
                          label: t('providers.defaultNone'),
                        },
                        ...modelsWithTag.map((m) => ({
                          value: m.id,
                          label: m.displayName,
                        })),
                      ]}
                      value={form.defaults[tag] ?? NONE_VALUE}
                      onValueChange={(value) =>
                        setForm((f) => ({
                          ...f,
                          defaults: { ...f.defaults, [tag]: value },
                        }))
                      }
                    />
                  );
                })}
              </Stack>
            </div>
          </Stack>
        </div>

        <div className="border-border shrink-0 border-t p-4 sm:px-6 sm:py-4">
          <HStack justify="end" align="center">
            <Button type="submit" disabled={isPending || !isDirty || !isValid}>
              {isPending ? (
                <>
                  <Loader2 className="mr-2 size-4 animate-spin" />
                  {t('providers.saving')}
                </>
              ) : (
                t('providers.saveChanges')
              )}
            </Button>
          </HStack>
        </div>
      </form>
    </Sheet>
  );
}
