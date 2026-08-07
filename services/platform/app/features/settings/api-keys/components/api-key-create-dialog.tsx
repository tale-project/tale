'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { Button } from '@tale/ui/button';
import { Text } from '@tale/ui/text';
import { Copy, Check } from 'lucide-react';
import { useMemo, useState } from 'react';
import * as z from 'zod';

import { FormDialog } from '@/app/components/ui/dialog/form-dialog';
import { FormSection } from '@/app/components/ui/forms/form-section';
import { Input } from '@/app/components/ui/forms/input';
import { Select } from '@/app/components/ui/forms/select';
import { useForm } from '@/app/components/ui/forms/use-form';
import { useToast } from '@/app/hooks/use-toast';
import { useT } from '@/lib/i18n/client';

import { useCreateApiKey } from '../hooks/use-api-keys';

/** Better Auth's apiKey plugin caps the key name at its `maximumNameLength`
 *  default (32) — `convex/auth.ts` sets no override. Mirror it client-side so a
 *  too-long name is rejected inline instead of returning a generic 400 toast. */
const API_KEY_NAME_MAX = 32;

interface ApiKeyCreateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organizationId: string;
  onSuccess?: () => void;
}

type ApiKeyFormData = {
  name: string;
  expiresIn: string;
};

export function ApiKeyCreateDialog({
  open,
  onOpenChange,
  organizationId,
  onSuccess,
}: ApiKeyCreateDialogProps) {
  const { t: tSettings } = useT('settings');
  const { t: tCommon } = useT('common');
  const { toast } = useToast();
  const { mutateAsync: createKey, isPending: isSubmitting } =
    useCreateApiKey(organizationId);

  const [createdKey, setCreatedKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const expiresOptions = useMemo(
    () => [
      {
        value: '604800',
        label: tSettings('apiKeys.form.expiresOptions.7days'),
      },
      {
        value: '2592000',
        label: tSettings('apiKeys.form.expiresOptions.30days'),
      },
      {
        value: '7776000',
        label: tSettings('apiKeys.form.expiresOptions.90days'),
      },
      {
        value: '31536000',
        label: tSettings('apiKeys.form.expiresOptions.1year'),
      },
      { value: '0', label: tSettings('apiKeys.form.expiresOptions.never') },
    ],
    [tSettings],
  );

  const nameRequiredError = tSettings('apiKeys.form.nameRequired');
  const nameTooLongError = tCommon('validation.maxLength', {
    field: tSettings('apiKeys.form.name'),
    max: API_KEY_NAME_MAX,
  });
  const schema = useMemo(
    () =>
      z.object({
        name: z
          .string()
          .trim()
          .min(1, nameRequiredError)
          .max(API_KEY_NAME_MAX, nameTooLongError),
        expiresIn: z.string(),
      }),
    [nameRequiredError, nameTooLongError],
  );

  const form = useForm<ApiKeyFormData>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: '',
      expiresIn: '2592000',
    },
  });

  const { handleSubmit, register, reset, formState, setValue, watch } = form;
  const expiresInValue = watch('expiresIn');

  const onSubmit = async (data: ApiKeyFormData) => {
    try {
      const expiresIn =
        data.expiresIn === '0' ? undefined : parseInt(data.expiresIn, 10);

      const result = await createKey({
        name: data.name,
        expiresIn,
      });

      setCreatedKey(result.key);

      toast({
        title: tSettings('apiKeys.keyCreated'),
        variant: 'success',
      });

      onSuccess?.();
    } catch (error) {
      console.error(error);
    }
  };

  const handleCopyKey = async () => {
    if (!createdKey) return;

    try {
      await navigator.clipboard.writeText(createdKey);
      setCopied(true);
      toast({
        title: tSettings('apiKeys.keyCopied'),
        variant: 'success',
      });
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast({
        title: tCommon('errors.failedToCopy'),
        variant: 'destructive',
      });
    }
  };

  const handleOpenChange = (newOpen: boolean) => {
    if (!newOpen) {
      reset();
      setCreatedKey(null);
      setCopied(false);
    }
    onOpenChange(newOpen);
  };

  if (createdKey) {
    return (
      <FormDialog
        open={open}
        onOpenChange={handleOpenChange}
        title={tSettings('apiKeys.keyCreated')}
        submitText={tCommon('actions.done')}
        isSubmitting={false}
        onSubmit={() => handleOpenChange(false)}
        customFooter={
          <Button type="submit" onClick={() => handleOpenChange(false)}>
            {tCommon('actions.done')}
          </Button>
        }
      >
        <FormSection>
          <Text variant="muted">
            {tSettings('apiKeys.keyCreatedDescription')}
          </Text>
          <div className="space-y-2">
            <Text as="label" variant="label">
              {tSettings('apiKeys.yourApiKey')}
            </Text>
            <div className="relative">
              <code className="bg-muted block w-full rounded-md p-3 pr-12 font-mono text-sm break-all">
                {createdKey}
              </code>
              <Button
                type="button"
                variant="ghost"
                onClick={handleCopyKey}
                className="absolute top-1/2 right-2 -translate-y-1/2"
                aria-label={tCommon('actions.copy')}
              >
                {copied ? (
                  <Check className="text-success size-4" />
                ) : (
                  <Copy className="size-4" />
                )}
              </Button>
            </div>
          </div>
        </FormSection>
      </FormDialog>
    );
  }

  return (
    <FormDialog
      open={open}
      onOpenChange={handleOpenChange}
      title={tSettings('apiKeys.createKey')}
      submitText={tSettings('apiKeys.createKeySubmit')}
      submittingText={tCommon('actions.loading')}
      isSubmitting={isSubmitting}
      isValid={formState.isValid}
      onSubmit={handleSubmit(onSubmit)}
    >
      <FormSection>
        <Input
          id="name"
          label={tSettings('apiKeys.form.name')}
          placeholder={tSettings('apiKeys.form.namePlaceholder')}
          {...register('name')}
          className="w-full"
          required
          errorMessage={formState.errors.name?.message}
        />
        <Select
          id="expiresIn"
          label={tSettings('apiKeys.form.expiresIn')}
          value={expiresInValue}
          onValueChange={(value) =>
            setValue('expiresIn', value, { shouldDirty: true })
          }
          options={expiresOptions}
        />
      </FormSection>
    </FormDialog>
  );
}
