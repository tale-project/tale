'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { Copy, Check } from 'lucide-react';
import { useState, useMemo } from 'react';
import { useForm } from 'react-hook-form';
import * as z from 'zod';

import { FormDialog } from '@/app/components/ui/dialog/form-dialog';
import { Input } from '@/app/components/ui/forms/input';
import { Select } from '@/app/components/ui/forms/select';
import { Stack } from '@/app/components/ui/layout/layout';
import { Button } from '@/app/components/ui/primitives/button';
import { useToast } from '@/app/hooks/use-toast';
import { useT } from '@/lib/i18n/client';

import { useCreateApiKey } from '../hooks/use-api-keys';

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
  const { mutateAsync: createKey } = useCreateApiKey(organizationId);

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
  const schema = useMemo(
    () =>
      z.object({
        name: z.string().trim().min(1, nameRequiredError),
        expiresIn: z.string(),
      }),
    [nameRequiredError],
  );

  const [isSubmitting, setIsSubmitting] = useState(false);

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
    setIsSubmitting(true);
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
      toast({
        title: tCommon('errors.generic'),
        variant: 'destructive',
      });
    } finally {
      setIsSubmitting(false);
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
        <Stack gap={4}>
          <p className="text-muted-foreground text-sm">
            {tSettings('apiKeys.keyCreatedDescription')}
          </p>
          <div className="relative">
            <code className="bg-muted block w-full rounded-md p-3 pr-12 font-mono text-sm break-all">
              {createdKey}
            </code>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={handleCopyKey}
              className="absolute top-1/2 right-2 -translate-y-1/2"
              aria-label={tCommon('actions.copy')}
            >
              {copied ? (
                <Check className="size-4 text-green-500" />
              ) : (
                <Copy className="size-4" />
              )}
            </Button>
          </div>
        </Stack>
      </FormDialog>
    );
  }

  return (
    <FormDialog
      open={open}
      onOpenChange={handleOpenChange}
      title={tSettings('apiKeys.createKey')}
      submitText={tCommon('actions.create')}
      submittingText={tCommon('actions.loading')}
      isSubmitting={isSubmitting}
      onSubmit={handleSubmit(onSubmit)}
    >
      <Stack gap={4}>
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
          onValueChange={(value) => setValue('expiresIn', value)}
          options={expiresOptions}
        />
      </Stack>
    </FormDialog>
  );
}
